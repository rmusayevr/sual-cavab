import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAfterDelay } from "./useAfterDelay";

// #38: Render's free services sleep after 15 idle minutes; measured, the API takes 83 to 93 s to
// answer the first request and the web service about 33 s. A person who waits that long needs to be
// told why. This hook says "this has been going on for a while".
describe("useAfterDelay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is false at first and true once the thing has been active for the whole delay", () => {
    const { result } = renderHook(() => useAfterDelay(true, 5000));

    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(4999));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("never turns true when the thing is not active", () => {
    const { result } = renderHook(() => useAfterDelay(false, 5000));

    act(() => vi.advanceTimersByTime(60_000));

    expect(result.current).toBe(false);
  });

  it("goes back to false as soon as the thing finishes, and starts counting again next time", () => {
    const { result, rerender } = renderHook(({ active }) => useAfterDelay(active, 5000), { initialProps: { active: true } });
    act(() => vi.advanceTimersByTime(6000));
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);

    rerender({ active: true });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(true);
  });

  it("leaves no timer behind when the component goes away", () => {
    const { unmount } = renderHook(() => useAfterDelay(true, 5000));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("defaults to five seconds", () => {
    const { result } = renderHook(() => useAfterDelay(true));

    act(() => vi.advanceTimersByTime(4999));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });
});
