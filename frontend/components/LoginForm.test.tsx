import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginForm from "./LoginForm";

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

function submit(email = "ada@example.com", password = "secret-for-tests") {
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

    submit("ada@example.com", "secret-for-tests");

    await vi.waitFor(() => expect(replace).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls.find(([u]) => u === "/api/auth/login/")!;
    expect(url).toBe("/api/auth/login/");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "ada@example.com", password: "secret-for-tests" });
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
