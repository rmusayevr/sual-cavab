import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cx } from "@/lib/cx";

import { Alert } from "./Alert";
import { Button } from "./Button";
import { Card } from "./Card";
import { CarpetStrip, EmptyState, Eyebrow, LedgerLoading } from "./Ledger";
import { Field, Input, Select, Textarea } from "./Field";
import { PageShell } from "./PageShell";
import { STATUSES, statusDot, statusLabel, type QuestionStatus } from "@/lib/status";

import { StatusChip } from "./StatusChip";

describe("cx", () => {
  it("joins class names and skips empty ones", () => {
    expect(cx("a", false, null, undefined, "", "b")).toBe("a b");
  });
});

describe("Button", () => {
  it("is a plain button by default, so it never submits a form by accident", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("can submit when asked to", () => {
    render(<Button type="submit">Send</Button>);

    expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute("type", "submit");
  });

  it("is at least 44 px tall, so it can be tapped on a phone", () => {
    render(<Button>Tap</Button>);

    expect(screen.getByRole("button")).toHaveClass("min-h-11");
  });

  it("uses the page font, and the filled variants have a border of their own, because there is no browser reset", () => {
    // Without Tailwind's reset a button keeps the browser's system font and its 2px outset border (review of #62).
    render(
      <>
        <Button variant="primary">One</Button>
        <Button variant="secondary">Two</Button>
        <Button variant="danger">Three</Button>
      </>,
    );

    for (const name of ["One", "Two", "Three"]) expect(screen.getByRole("button", { name })).toHaveClass("font-sans");
    for (const name of ["One", "Three"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("border", "border-transparent");
    }
    // the outline variant draws its own border (the example's btn-ghost)
    expect(screen.getByRole("button", { name: "Two" })).toHaveClass("btn-ghost");
  });

  it("the outline button takes the colour of what it sits on, so it reads on paper and on navy", () => {
    render(<Button variant="secondary">Two</Button>);

    // a button does not inherit colour by itself; the outline is currentColor (the example's btn-ghost)
    expect(screen.getByRole("button", { name: "Two" })).toHaveClass("btn-ghost", "text-inherit");
    expect(screen.getByRole("button", { name: "Two" })).not.toHaveClass("text-foreground");
  });

  it("takes its look from the design: red for the action, an outline for the rest, the destructive colour for dropping", () => {
    render(
      <>
        <Button variant="primary">One</Button>
        <Button variant="secondary">Two</Button>
        <Button variant="danger">Three</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "One" })).toHaveClass("btn-primary");
    expect(screen.getByRole("button", { name: "Two" })).toHaveClass("btn-ghost");
    expect(screen.getByRole("button", { name: "Three" })).toHaveClass("btn-danger");
  });

  it("looks different for each variant", () => {
    render(
      <>
        <Button variant="primary">One</Button>
        <Button variant="secondary">Two</Button>
        <Button variant="danger">Three</Button>
      </>,
    );
    const classes = ["One", "Two", "Three"].map((name) => screen.getByRole("button", { name }).className);

    expect(new Set(classes).size).toBe(3);
  });

  it("can be disabled and keeps a caller's own classes", () => {
    render(
      <Button disabled className="w-full">
        Wait
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Wait" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Wait" })).toHaveClass("w-full");
  });
});

describe("Field", () => {
  it("ties the label to its control", () => {
    render(<Field label="Email">{(props) => <Input type="email" {...props} />}</Field>);

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("points the control at its hint and its error, and marks it invalid on an error", () => {
    render(
      <Field label="Question" hint="Keep it short" error="Text is required">
        {(props) => <Textarea {...props} />}
      </Field>,
    );
    const control = screen.getByLabelText("Question");

    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription("Keep it short Text is required");
  });

  it("is not marked invalid, and describes nothing, without a hint or an error", () => {
    render(<Field label="Name">{(props) => <Input {...props} />}</Field>);
    const control = screen.getByLabelText("Name");

    expect(control).not.toHaveAttribute("aria-invalid");
    expect(control).not.toHaveAttribute("aria-describedby");
  });

  it("every control uses the page font, because there is no browser reset", () => {
    // Form controls do not inherit the page font by themselves (a textarea is monospace).
    render(
      <>
        <Input aria-label="a" />
        <Textarea aria-label="b" />
        <Select aria-label="c" />
      </>,
    );

    for (const label of ["a", "b", "c"]) expect(screen.getByLabelText(label)).toHaveClass("font-sans");
  });

  it("gives two fields their own ids", () => {
    render(
      <>
        <Field label="First">{(props) => <Input {...props} />}</Field>
        <Field label="Second">{(props) => <Input {...props} />}</Field>
      </>,
    );

    expect(screen.getByLabelText("First").id).not.toBe(screen.getByLabelText("Second").id);
  });
});

describe("StatusChip", () => {
  const all: QuestionStatus[] = ["open", "asked", "answered", "dropped"];

  it("always shows the status as a word", () => {
    render(
      <>
        {all.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </>,
    );

    for (const word of ["Open", "Asked", "Answered", "Dropped"]) expect(screen.getByText(word)).toBeInTheDocument();
  });

  it("shows each status as the word from the one table and a dot of the colour from the same table", () => {
    render(
      <>
        {all.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </>,
    );

    for (const status of all) {
      const chip = screen.getByText(statusLabel[status]);
      expect(chip.firstElementChild).toHaveClass(statusDot[status]);
      expect(chip.firstElementChild).toHaveAttribute("aria-hidden", "true"); // the word carries the meaning
    }
    expect(new Set(all.map((s) => statusDot[s])).size).toBe(4);
  });
});

describe("the status table", () => {
  it("has the same four statuses for the words and for the dots", () => {
    expect(Object.keys(statusLabel).sort()).toEqual([...STATUSES].sort());
    expect(Object.keys(statusDot).sort()).toEqual([...STATUSES].sort());
  });
});

describe("Alert", () => {
  it("announces an error at once, in the red the design uses as emphasis (not the destructive colour)", () => {
    render(<Alert tone="error">Could not save</Alert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
    expect(screen.getByRole("alert")).toHaveClass("border-primary", "text-primary");
    expect(screen.getByRole("alert")).not.toHaveClass("text-destructive");
  });

  it("announces information politely", () => {
    render(<Alert>Saved</Alert>);

    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Card and PageShell", () => {
  it("a card shows what it holds, with the small radius and the one shadow of the design", () => {
    render(<Card>Inside</Card>);

    expect(screen.getByText("Inside")).toHaveClass("rounded-md", "shadow-card", "bg-card");
    expect(screen.getByText("Inside")).not.toHaveClass("rounded-xl", "rounded-2xl");
  });

  it("a page has one main area, and a heading when it has a title", () => {
    render(<PageShell title="Projects">List</PageShell>);

    expect(screen.getByRole("main")).toHaveTextContent("List");
    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
  });

  it("a page without a title has no heading", () => {
    render(<PageShell>List</PageShell>);

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});

describe("long words and the shared pieces (reviews of #56 and #57)", () => {
  it("a page, and a card in it, let a long unbroken word (a pasted link) wrap instead of being clipped on a phone", () => {
    render(
      <PageShell title="T">
        <Card>Inside</Card>
      </PageShell>,
    );

    // grid-cols-1 lets the column shrink below the word; overflow-wrap:anywhere lets the word break.
    expect(screen.getByRole("main")).toHaveClass("grid-cols-1", "[overflow-wrap:anywhere]");
    expect(screen.getByText("Inside")).toHaveClass("[overflow-wrap:anywhere]", "min-w-0");
  });

  it("a text area is as tall as its rows say, not at least four lines", () => {
    render(<Textarea aria-label="short" rows={1} />);

    expect(screen.getByLabelText("short")).not.toHaveClass("min-h-24");
  });

  it("an information message stands out from the card it sits in", () => {
    render(<Alert>Heads up</Alert>);

    // the saffron rule of the example's message card, in the text colour (not the error red)
    expect(screen.getByRole("status")).toHaveClass("border-l-4", "border-l-saffron", "text-foreground");
    expect(screen.getByRole("status")).not.toHaveClass("text-primary");
  });
});

describe("ledger pieces (#72)", () => {
  it("a carpet strip is a thin decoration that screen readers skip", () => {
    const { container } = render(<CarpetStrip />);

    const strip = container.firstElementChild!;
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(strip).toHaveClass("h-2", "pattern-carpet");
  });

  it("an eyebrow is small monospace capitals: red on paper, saffron on navy", () => {
    render(
      <>
        <Eyebrow>Paper</Eyebrow>
        <Eyebrow tone="navy">Navy</Eyebrow>
      </>,
    );

    expect(screen.getByText("Paper")).toHaveClass("font-mono", "text-xs", "uppercase", "text-primary");
    expect(screen.getByText("Navy")).toHaveClass("font-mono", "uppercase", "text-saffron");
    expect(screen.getByText("Paper")).not.toHaveClass("text-saffron"); // saffron is 2:1 on paper
  });

  it("the loading state says what is loading, and shows ledger rows that fill in (not a spinner)", () => {
    const { container } = render(<LedgerLoading label="Loading things…" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading things…");
    const rows = container.querySelectorAll('[aria-hidden="true"] > div');
    expect(rows.length).toBe(3);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass("motion-safe:animate-pulse");
  });

  it("an empty state can leave out its strip when the page already has the one it is allowed", () => {
    const { container } = render(<EmptyState strip={false}>Nothing here yet.</EmptyState>);

    expect(container.querySelectorAll(".pattern-carpet")).toHaveLength(0);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("an empty state is a card under a carpet strip, with what to do next", () => {
    const { container } = render(<EmptyState>Nothing here yet.</EmptyState>);

    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("rounded-md", "shadow-card", "bg-card");
    expect(container.firstElementChild!.firstElementChild).toHaveClass("pattern-carpet");
  });
});
