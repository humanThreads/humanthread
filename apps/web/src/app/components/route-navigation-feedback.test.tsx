// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteNavigationFeedback } from "./route-navigation-feedback";

const navigation = vi.hoisted(() => ({ pathname: "/tasks" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

function progress(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-route-progress="true"]')!;
}

function appendLink(href: string, attributes: Record<string, string> = {}) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = "导航";
  for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
  link.addEventListener("click", (event) => event.preventDefault());
  document.body.append(link);
  return link;
}

beforeEach(() => {
  navigation.pathname = "/tasks";
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("RouteNavigationFeedback", () => {
  it("shows immediate progress for an internal navigation and clears it after the route changes", async () => {
    const { container, rerender } = render(<RouteNavigationFeedback />);
    const link = appendLink("/projects");

    fireEvent.click(link);

    expect(progress(container).dataset.state).toBe("active");
    expect(link.dataset.routePending).toBe("true");

    navigation.pathname = "/projects";
    rerender(<RouteNavigationFeedback />);
    expect(progress(container).dataset.state).toBe("completing");

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(progress(container).dataset.state).toBe("idle");
    expect(link.dataset.routePending).toBeUndefined();
  });

  it("does not show progress for external, modified, or opted-out navigation", () => {
    const { container } = render(<RouteNavigationFeedback />);

    fireEvent.click(appendLink("https://example.com/report"));
    expect(progress(container).dataset.state).toBe("idle");

    const internal = appendLink("/team");
    fireEvent.click(internal, { metaKey: true });
    expect(progress(container).dataset.state).toBe("idle");

    fireEvent.click(appendLink("/documents", { "data-no-route-progress": "true" }));
    expect(progress(container).dataset.state).toBe("idle");
  });
});
