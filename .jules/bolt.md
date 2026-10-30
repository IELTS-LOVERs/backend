## 2026-10-30 - Unit Test Mocking Constraints on `.lean()` Optimizations

**Learning:** Chaining `.lean()` onto Mongoose queries in services (`practice.service.ts`) where unit tests mock Mongoose methods (`vi.spyOn(Model, "find").mockReturnValueOnce({ sort: vi.fn() })`) causes test failures if the mock chain does not include `.lean()`.
**Action:** Always check existing test mocks before adding `.lean()` to Mongoose query chains in service functions, or verify that tests run against real Mongoose query builders or adequately mocked query chains.
