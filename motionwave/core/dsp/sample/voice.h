// Motion Wave — Slipstream Sampler instrument voice layer. `smp-01` §2, §4.6, §7.4.
//
// The read engines already own interpolation/time-stretch state. This layer owns
// the state that is *a note*: allocator slot, amplitude envelope, per-voice SVF,
// equal-power pan, and the 20 ms old/new reader crossfade used for engine changes.
//
// `warm()` is deliberately separate from `start()`. SpectralRead owns vectors;
// warming both reader banks at the largest FFT makes later note-ons and engine
// switches capacity-preserving, so the render path never grows storage.
#pragma once

#include "../svf.h"
#include "../voice/envelope.h"
#include "../voice/note_id.h"
#include "../voice/trigger_bus.h"
#include "../voice/voice_set.h"
#include "classic_read.h"
#include "granular_read.h"
#include "spectral_read.h"
#include "voice_params.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace mw::dsp::sample {

inline constexpr int kSamplerMaxVoices = 64;

struct SampleVoiceSource {
  Zone zone{};
  const float* data = nullptr;
  std::size_t frames = 0;
  double fileRate = 48000.0;
  const MipMap* mip = nullptr;
  const SincTable* sinc = nullptr;
  const SpectralHead* spectralHead = nullptr;
};

struct SampleVoiceConfig {
  param::VoiceLayerControls layer{};
  GranularParams granular{};
  SpectralControls spectral{};
  float speed = 1.0f;
};

class SampleVoice {
 public:
  void warm(double hostRate) {
    hostRate_ = hostRate > 0.0 ? hostRate : 48000.0;
    filter_.prepare(hostRate_);
    amp_.prepare(hostRate_);
    SpectralControls max;
    max.fftSize = 4096;
    ClassicSource empty;
    banks_[0].spectral.prepare(empty, nullptr, Quality::High, hostRate_, max, nullptr, 0u);
    banks_[1].spectral.prepare(empty, nullptr, Quality::High, hostRate_, max, nullptr, 1u);
    warmed_ = true;
  }

  void start(const SampleVoiceSource& source, const SampleVoiceConfig& config, int midiNote,
             int velocity, std::uint64_t seed, int noteOnOffset = 0) {
    if (!warmed_) warm(hostRate_);
    source_ = source;
    config_ = config;
    note_ = midiNote;
    velocity_ = velocity < 1 ? 1 : (velocity > 127 ? 127 : velocity);
    seed_ = seed;
    gate_ = true;
    triggerPending_ = true;
    switching_ = false;
    hasPendingEngine_ = false;
    pendingEngine_ = Engine::Classic;
    logicalFrame_ = static_cast<double>(source_.zone.start);
    setupEnvelope();
    filter_.prepare(hostRate_);
    filter_.setMode(config_.layer.filterMode);
    activeBank_ = 0;
    prepareBank(activeBank_, config_.layer.engine, noteOnOffset);
    currentRequested_ = config_.layer.engine;
    currentActual_ = banks_[activeBank_].actual;
    active_ = true;
  }

  void release() noexcept {
    if (!active_) return;
    gate_ = false;
    banks_[activeBank_].release();
    if (switching_) banks_[1 - activeBank_].release();
  }

  void requestEngine(Engine engine) {
    if (!active_ || engine == currentRequested_) return;
    if (switching_) {
      pendingEngine_ = engine;
      hasPendingEngine_ = true;
      return;
    }
    beginSwitch(engine);
  }

  void render(float* left, float* right, int frames) noexcept {
    if (left == nullptr || right == nullptr || frames <= 0) return;
    for (int i = 0; i < frames; ++i) {
      left[i] = 0.0f;
      right[i] = 0.0f;
      if (!active_) continue;

      const float pitch = pitchSemitones();
      const float speed = config_.speed;
      float sample = banks_[activeBank_].renderOne(pitch, speed);
      if (switching_) {
        const int incoming = 1 - activeBank_;
        const float other = banks_[incoming].renderOne(pitch, speed);
        const float t = 1.0f - static_cast<float>(switchRemaining_) /
                                   static_cast<float>(switchTotal_);
        // Equal-gain is intentional: two matched readers remain unity during a
        // switch rather than gaining 3 dB as an equal-power crossfade would.
        sample = sample * (1.0f - t) + other * t;
        if (--switchRemaining_ <= 0) finishSwitch();
      }

      voice::TriggerBus bus;
      bus.single = triggerPending_;
      bus.multi = triggerPending_;
      bus.gate = gate_;
      const float env = amp_.advance(bus, 1);
      triggerPending_ = false;

      const double keyCutoff =
          mw::dsp::Svf::cutoffFor(config_.layer.cutoffHz, config_.layer.keyFollow,
                                  static_cast<double>(note_));
      const float filtered =
          filter_.process(sample, static_cast<float>(keyCutoff), config_.layer.resonance);
      const float amp = env * static_cast<float>(gainLinear()) * velocityGain();
      const float p = clamp(config_.layer.pan + static_cast<float>(source_.zone.pan), -1.0f, 1.0f);
      const double angle = (static_cast<double>(p) + 1.0) * kPi * 0.25;
      left[i] = filtered * amp * static_cast<float>(std::cos(angle));
      right[i] = filtered * amp * static_cast<float>(std::sin(angle));

      advanceLogical(pitch, speed);
      if (amp_.finished()) active_ = false;
    }
  }

  bool active() const noexcept { return active_; }
  bool gate() const noexcept { return gate_; }
  float envelopeLevel() const noexcept { return amp_.value(); }
  Engine requestedEngine() const noexcept { return currentRequested_; }
  Engine actualEngine() const noexcept { return currentActual_; }
  bool switching() const noexcept { return switching_; }
  int switchSamplesRemaining() const noexcept { return switchRemaining_; }

 private:
  struct ReaderBank {
    ClassicRead classic;
    GranularRead granular;
    SpectralRead spectral;
    Engine requested = Engine::Classic;
    Engine actual = Engine::Classic;

    float renderOne(float pitch, float speed) noexcept {
      float out = 0.0f;
      switch (actual) {
        case Engine::Granular: granular.render(&out, 1, &pitch, &speed); break;
        case Engine::Spectral: spectral.render(&out, 1, &pitch, &speed); break;
        case Engine::Classic:
        case Engine::Hybrid:
        default: classic.render(&out, 1, &pitch, &speed); break;
      }
      return out;
    }
    void release() noexcept {
      switch (actual) {
        case Engine::Granular: granular.release(); break;
        case Engine::Spectral: spectral.release(); break;
        case Engine::Classic:
        case Engine::Hybrid:
        default: classic.release(); break;
      }
    }
  };

  static constexpr double kPi = 3.14159265358979323846;
  static float clamp(float v, float lo, float hi) noexcept {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  void setupEnvelope() noexcept {
    voice::EnvelopeShape shape;
    shape.count = 4;
    shape.sustainSegment = 2;
    shape.endSegment = 3;
    shape.domain = voice::EnvelopeDomain::Linear;
    shape.drive = voice::SegmentDrive::Duration;
    shape.floorValue = 0.0f;
    shape.gated = true;
    shape.resetOnTrigger = true;
    shape.segments[0] = {1.0f, config_.layer.attack, voice::SegmentCurve::Linear, 1.0f};
    shape.segments[1] = {config_.layer.sustain, config_.layer.decay,
                         voice::SegmentCurve::Exponential, 3.5f};
    shape.segments[2] = {config_.layer.sustain, 0.0001f, voice::SegmentCurve::Linear, 1.0f};
    shape.segments[3] = {0.0f, config_.layer.release, voice::SegmentCurve::Exponential, 3.5f};
    amp_.setShape(shape);
  }

  ClassicSource sourceAt(double frame) const noexcept {
    ClassicSource s = sourceFor(source_.zone, source_.data, source_.frames, source_.fileRate,
                                source_.mip, 0);
    const double hi = static_cast<double>(s.frames);
    const double clamped = frame < 0.0 ? 0.0 : (frame > hi ? hi : frame);
    s.sampleStart = static_cast<std::size_t>(clamped);
    return s;
  }

  void prepareBank(int index, Engine requested, int noteOnOffset) {
    ReaderBank& b = banks_[index];
    b.requested = requested;
    b.actual = requested == Engine::Hybrid ? Engine::Classic : requested;
    const ClassicSource source = sourceAt(logicalFrame_);
    if (b.actual == Engine::Granular) {
      b.granular.prepare(source, source_.sinc, config_.layer.quality, hostRate_,
                         config_.granular, seed_ + static_cast<std::uint64_t>(index), noteOnOffset);
    } else if (b.actual == Engine::Spectral) {
      b.spectral.prepare(source, source_.sinc, config_.layer.quality, hostRate_,
                         config_.spectral, source_.spectralHead,
                         static_cast<std::uint32_t>(seed_ + static_cast<std::uint64_t>(index)));
    } else {
      b.classic.prepare(source, source_.sinc, config_.layer.quality, hostRate_);
    }
  }

  void beginSwitch(Engine engine) {
    prepareBank(1 - activeBank_, engine, 0);
    switchTotal_ = static_cast<int>(hostRate_ * 0.020 + 0.5);
    if (switchTotal_ < 1) switchTotal_ = 1;
    switchRemaining_ = switchTotal_;
    switching_ = true;
    currentRequested_ = engine;
  }

  void finishSwitch() noexcept {
    activeBank_ = 1 - activeBank_;
    currentActual_ = banks_[activeBank_].actual;
    switching_ = false;
    switchRemaining_ = 0;
    if (hasPendingEngine_ && pendingEngine_ != currentRequested_) {
      const Engine next = pendingEngine_;
      hasPendingEngine_ = false;
      beginSwitch(next);
    } else {
      hasPendingEngine_ = false;
    }
  }

  float pitchSemitones() const noexcept {
    const double keys = (static_cast<double>(note_) - static_cast<double>(source_.zone.root)) *
                        source_.zone.keyTracking;
    return static_cast<float>(keys + source_.zone.fineCents / 100.0);
  }

  double gainLinear() const noexcept {
    return std::pow(10.0, (source_.zone.gainDb + static_cast<double>(config_.layer.gainDb)) / 20.0);
  }

  float velocityGain() const noexcept {
    const float v = static_cast<float>(velocity_) / 127.0f;
    const float shaped = std::pow(v, 1.5f);
    const float amount = clamp(config_.layer.velocityAmp, 0.0f, 1.0f);
    return 1.0f + amount * (shaped - 1.0f);
  }

  void advanceLogical(float pitch, float speed) noexcept {
    const double fileToHost = source_.fileRate / hostRate_;
    const bool followsPitch = currentActual_ == Engine::Classic;
    const double pitchRatio = followsPitch ? semitoneRatio(static_cast<double>(pitch)) : 1.0;
    logicalFrame_ += pitchRatio * static_cast<double>(speed) * fileToHost;
  }

  SampleVoiceSource source_{};
  SampleVoiceConfig config_{};
  ReaderBank banks_[2]{};
  voice::Envelope amp_{};
  mw::dsp::Svf filter_{};
  double hostRate_ = 48000.0;
  double logicalFrame_ = 0.0;
  std::uint64_t seed_ = 0;
  int note_ = 60;
  int velocity_ = 127;
  int activeBank_ = 0;
  int switchTotal_ = 1;
  int switchRemaining_ = 0;
  Engine currentRequested_ = Engine::Classic;
  Engine currentActual_ = Engine::Classic;
  Engine pendingEngine_ = Engine::Classic;
  bool warmed_ = false;
  bool active_ = false;
  bool gate_ = false;
  bool triggerPending_ = false;
  bool switching_ = false;
  bool hasPendingEngine_ = false;
};

class SamplerVoicePool {
 public:
  void prepare(double sampleRate, int polyphony = 32) {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    voice::VoiceSetConfig setConfig;
    setConfig.capacity = kSamplerMaxVoices;
    setConfig.allocation = voice::Allocation::LowestFree;
    setConfig.stealOrder = voice::StealOrder::ReleasingQuietestFirst;
    setConfig.stealFadeMs = 1.5f;
    set_.prepare(setConfig);
    set_.setCapacity(polyphony);
    for (auto& v : voices_) v.warm(sampleRate_);
  }

  voice::VoiceId noteOn(voice::NoteId id, int midiNote, int velocity,
                        const SampleVoiceSource& source, const SampleVoiceConfig& config,
                        std::uint64_t seed) {
    set_.setCapacity(config.layer.polyphony);
    const voice::VoiceId slot = set_.allocate(id);
    syncMembership();
    voices_[slot].start(source, config, midiNote, velocity,
                        seed ^ static_cast<std::uint64_t>(slot));
    return slot;
  }

  bool noteOff(voice::NoteId id) noexcept {
    const voice::VoiceId slot = set_.voiceOf(id);
    if (slot == voice::kNoVoice) return false;
    if (!set_.releaseNote(id)) return false;
    voices_[slot].release();
    return true;
  }

  void requestEngine(Engine engine) {
    for (std::size_t i = 0; i < voices_.size(); ++i) {
      if (set_.noteOf(static_cast<voice::VoiceId>(i)) != voice::kNoNote) {
        voices_[i].requestEngine(engine);
      }
    }
  }

  void panic() noexcept {
    set_.panic();
    for (auto& v : voices_) {
      if (v.active()) v.release();
    }
  }

  void render(float* left, float* right, int frames) noexcept {
    if (left == nullptr || right == nullptr || frames <= 0) return;
    for (int i = 0; i < frames; ++i) {
      left[i] = 0.0f;
      right[i] = 0.0f;
    }
    set_.beginBlock();
    std::array<float, 1> l{};
    std::array<float, 1> r{};
    for (std::size_t slot = 0; slot < voices_.size(); ++slot) {
      const auto id = static_cast<voice::VoiceId>(slot);
      if (set_.noteOf(id) == voice::kNoNote) continue;
      for (int i = 0; i < frames; ++i) {
        voices_[slot].render(l.data(), r.data(), 1);
        left[i] += l[0];
        right[i] += r[0];
      }
      set_.setLevel(id, voices_[slot].envelopeLevel());
      if (!voices_[slot].active()) set_.retire(id);
    }
  }

  int liveCount() const noexcept { return set_.liveCount(); }
  int sustainingCount() const noexcept { return set_.sustainingCount(); }
  std::uint64_t stealCount() const noexcept { return set_.stealCount(); }
  SampleVoice& voiceAt(voice::VoiceId id) noexcept { return voices_[id]; }

 private:
  void syncMembership() noexcept {
    for (std::size_t i = 0; i < voices_.size(); ++i) {
      const auto id = static_cast<voice::VoiceId>(i);
      if (set_.noteOf(id) == voice::kNoNote && voices_[i].active()) voices_[i].release();
    }
  }

  std::array<SampleVoice, kSamplerMaxVoices> voices_{};
  voice::VoiceSet set_{};
  double sampleRate_ = 48000.0;
};

}  // namespace mw::dsp::sample
