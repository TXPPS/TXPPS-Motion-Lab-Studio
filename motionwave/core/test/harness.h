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

#define MW_TEST_MAIN(suite) \
  int main() { return ::mw::test::runAll(suite); }
