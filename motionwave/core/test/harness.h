// Motion Wave — the test harness.
//
// Deliberately tiny and dependency-free. ADR-0003 keeps the core free of
// third-party code so it can compile for a phone, a desktop and a WebAssembly
// sandbox without dragging a framework through every build; a test framework
// would be the first exception and there is no reason to make it.
//
// Failures print the file, the line, and both values, because a test that only
// says "false" costs more time than it saves.
#pragma once

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace mw::test {

struct Case {
  const char* name;
  void (*run)();
};

/// Registry. A file declares cases with MW_TEST and they add themselves here.
inline std::vector<Case>& registry() {
  static std::vector<Case> cases;
  return cases;
}

inline int& failures() {
  static int count = 0;
  return count;
}

inline const char*& currentCase() {
  static const char* name = "";
  return name;
}

inline void reportFailure(const char* file, int line, const std::string& detail) {
  ++failures();
  std::fprintf(stderr, "  FAIL %s\n    %s:%d\n    %s\n", currentCase(), file, line,
               detail.c_str());
}

struct Registrar {
  Registrar(const char* name, void (*run)()) { registry().push_back({name, run}); }
};

inline std::string fmt(double v) {
  char buffer[64];
  std::snprintf(buffer, sizeof(buffer), "%.9g", v);
  return buffer;
}

inline void expectTrue(bool ok, const char* expr, const char* file, int line) {
  if (!ok) reportFailure(file, line, std::string("expected true: ") + expr);
}

inline void expectNear(double actual, double expected, double tolerance, const char* expr,
                       const char* file, int line) {
  if (!(std::fabs(actual - expected) <= tolerance)) {
    reportFailure(file, line, std::string(expr) + " = " + fmt(actual) + ", expected " +
                                  fmt(expected) + " +/- " + fmt(tolerance));
  }
}

inline void expectEqInt(long long actual, long long expected, const char* expr, const char* file,
                        int line) {
  if (actual != expected) {
    reportFailure(file, line, std::string(expr) + " = " + std::to_string(actual) +
                                  ", expected " + std::to_string(expected));
  }
}

/**
 * Whether two measurements can meaningfully be compared at all.
 *
 * Split out from the assertion so the guard itself can be tested, which matters
 * — a guard against vacuous assertions that was itself vacuous would be the
 * same bug one level up.
 */
/**
 * A comparison between two measurements, refusing the degenerate cases.
 *
 * This exists because of a real one. A row asserting that the four-button
 * state's attack lag is at least ten times the 20:1 lag was timing both from
 * the wrong instant, so both measured 0.0 µs — and `0 >= 0 * 10` is true. The
 * case passed, printed two zeros, and proved nothing.
 *
 * That is a *class*, not an incident. Any assertion of the form "a is at least
 * N times b", "a exceeds b", or "a and b differ by at least d" is satisfied by
 * two zeros, and most are satisfied by two identical values whatever they are.
 * Nine units remain and each will write dozens of them, so the guard belongs
 * here rather than in each row's own head.
 *
 * `floor` is the magnitude below which a measurement is not a measurement — a
 * silent render, a crossing never found, a timer that never started. It has to
 * be given, because what counts as too small to believe is the row's knowledge
 * and not the harness's.
 */
inline bool isComparable(double a, double b, double floor) {
  return std::fabs(a) > floor && std::fabs(b) > floor && a != b;
}

inline bool expectComparable(double a, double b, double floor, const char* aExpr,
                             const char* bExpr, const char* file, int line) {
  const bool aDegenerate = !(std::fabs(a) > floor);
  const bool bDegenerate = !(std::fabs(b) > floor);
  if (aDegenerate || bDegenerate) {
    reportFailure(file, line,
                  std::string("degenerate comparison: ") + aExpr + " = " + fmt(a) + ", " + bExpr +
                      " = " + fmt(b) + " (both must exceed " + fmt(floor) +
                      " in magnitude before their ratio means anything)");
    return false;
  }
  if (a == b) {
    reportFailure(file, line,
                  std::string("degenerate comparison: ") + aExpr + " and " + bExpr +
                      " are both exactly " + fmt(a) +
                      " — a comparison between identical values proves nothing");
    return false;
  }
  return true;
}

/**
 * `a` is at least `factor` times `b`, with both operands checked first.
 *
 * The check is not a nicety in front of the assertion; it is half of it. An
 * "at least N times" claim is about a *relationship between two measurements*,
 * and if either measurement did not happen there is no relationship to assert.
 */
inline void expectAtLeastTimes(double a, double b, double factor, double floor, const char* aExpr,
                               const char* bExpr, const char* file, int line) {
  if (!expectComparable(a, b, floor, aExpr, bExpr, file, line)) return;
  if (!(a >= b * factor)) {
    reportFailure(file, line, std::string(aExpr) + " = " + fmt(a) + " is not at least " +
                                  fmt(factor) + "x " + bExpr + " = " + fmt(b));
  }
}

/// `a` exceeds `b` by at least `margin`, with both operands checked first.
inline void expectExceedsBy(double a, double b, double margin, double floor, const char* aExpr,
                            const char* bExpr, const char* file, int line) {
  if (!expectComparable(a, b, floor, aExpr, bExpr, file, line)) return;
  if (!(a - b >= margin)) {
    reportFailure(file, line, std::string(aExpr) + " = " + fmt(a) + " exceeds " + bExpr + " = " +
                                  fmt(b) + " by " + fmt(a - b) + ", needed " + fmt(margin));
  }
}

/// Runs every registered case. `MW_TEST_ONLY` in the environment filters by
/// substring, which is what you want when one case is failing and the rest are
/// noise.
inline int runAll(const char* suite) {
  const char* only = std::getenv("MW_TEST_ONLY");
  int ran = 0;
  std::printf("%s\n", suite);
  for (const Case& c : registry()) {
    if (only != nullptr && std::strstr(c.name, only) == nullptr) continue;
    currentCase() = c.name;
    const int before = failures();
    c.run();
    ++ran;
    if (failures() == before) std::printf("  ok   %s\n", c.name);
  }
  std::printf("%s: %d case(s), %d failure(s)\n", suite, ran, failures());
  return failures() == 0 ? 0 : 1;
}

}  // namespace mw::test

#define MW_CONCAT_INNER(a, b) a##b
#define MW_CONCAT(a, b) MW_CONCAT_INNER(a, b)

/// Declare a case. The name is a sentence describing the behaviour, not a
/// label — a failing test should read as a statement that stopped being true.
#define MW_TEST(name)                                                            \
  static void MW_CONCAT(mw_case_, __LINE__)();                                   \
  static ::mw::test::Registrar MW_CONCAT(mw_reg_, __LINE__)(                     \
      name, &MW_CONCAT(mw_case_, __LINE__));                                     \
  static void MW_CONCAT(mw_case_, __LINE__)()

#define MW_EXPECT(expr) ::mw::test::expectTrue((expr), #expr, __FILE__, __LINE__)
#define MW_EXPECT_NEAR(actual, expected, tol) \
  ::mw::test::expectNear((actual), (expected), (tol), #actual, __FILE__, __LINE__)
#define MW_EXPECT_EQ(actual, expected) \
  ::mw::test::expectEqInt((actual), (expected), #actual, __FILE__, __LINE__)

/// `a` is at least `factor` times `b`. Refuses two zeros and two equal values —
/// see `expectComparable`. `floor` is the magnitude below which a measurement is
/// not a measurement, and the row has to say what that is.
#define MW_EXPECT_AT_LEAST_TIMES(a, b, factor, floor) \
  ::mw::test::expectAtLeastTimes((a), (b), (factor), (floor), #a, #b, __FILE__, __LINE__)

/// `a` exceeds `b` by at least `margin`, with the same refusals.
#define MW_EXPECT_EXCEEDS_BY(a, b, margin, floor) \
  ::mw::test::expectExceedsBy((a), (b), (margin), (floor), #a, #b, __FILE__, __LINE__)

#define MW_TEST_MAIN(suite) \
  int main() { return ::mw::test::runAll(suite); }
