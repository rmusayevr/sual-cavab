import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginForm from "./LoginForm";
import { WAKING_TEXT } from "./ui/WakingNote";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

/** Login responds with `status`; the CSRF priming call always succeeds. */
function stubLogin(status: number) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
    url.endsWith("/csrf/") ? new Response(null, { status: 204 }) : new Response("{}", { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// made per run: a literal here looks like a leaked secret to a scanner (#44)
const TYPED = crypto.randomUUID();

function submit(email = "ada@example.com", password = TYPED) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginForm", () => {
  beforeEach(() => {
    replace.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("goes to the home page after a successful sign-in", async () => {
    stubLogin(200);
    render(<LoginForm />);

    submit();

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("posts the email and password as JSON to the login endpoint", async () => {
    const fetchMock = stubLogin(200);
    render(<LoginForm />);

    submit("ada@example.com", TYPED);

    await vi.waitFor(() => expect(replace).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls.find(([u]) => u === "/api/auth/login/")!;
    expect(url).toBe("/api/auth/login/");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "ada@example.com", password: TYPED });
  });

  it("shows one message for a wrong email or password", async () => {
    stubLogin(400);
    render(<LoginForm />);

    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("tells the user to wait when sign-in is throttled", async () => {
    stubLogin(429);
    render(<LoginForm />);

    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });
});

describe("LoginForm look (#54)", () => {
  it("uses the shared fields and button: typed, required, easy to tap", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(screen.getByLabelText("Email")).toHaveClass("min-h-11");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Password")).toBeRequired();
    expect(screen.getByLabelText("Password")).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveClass("min-h-11");
  });
});

describe("LoginForm: a slow sign-in (#38)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("says why when signing in takes more than five seconds, and not before", () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<LoginForm />);
    submit();

    expect(screen.queryByText(WAKING_TEXT)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText(WAKING_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled(); // still the same busy state
  });

  it("shows no note when nothing has been submitted", () => {
    vi.useFakeTimers();
    render(<LoginForm />);

    act(() => vi.advanceTimersByTime(60_000));

    expect(screen.queryByText(WAKING_TEXT)).not.toBeInTheDocument();
  });
});
