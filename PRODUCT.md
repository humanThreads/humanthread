# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

HumanThread serves delivery managers, engineering leads, project owners, and the
individual contributors who work with Codex, Claude, local Agents, and human
reviewers. They need to understand what should happen next, where execution is
blocked, and which project context supports a decision.

## Product Purpose

HumanThread is a human-in-the-loop delivery workspace. It connects company and
personal Spaces, projects, unified Tasks, documents, Agents, Loops, and approval
steps so work can be assigned, executed, reviewed, and traced without losing its
operational context.

Success means that both managers and implementers can follow the same delivery
thread from intent through execution and human confirmation.

## Positioning

The product treats human decisions and AI execution as one traceable delivery
thread: project context and documents inform a Task, an Agent or Loop performs
work, and approval or intervention returns the result to the same Task context.

## Operating Context

- A person can work across personal and company Spaces.
- Projects organize goals, milestones, members, Tasks, documents, and execution
  configuration.
- Unified Tasks are the operational unit for assignment, blockers, acceptance,
  and delivery follow-up.
- Documents preserve Markdown-compatible project and account context with
  revision history.
- Agents, Loops, MCP clients, and local tools execute or update work under the
  same access boundary as the Web application.
- Human approval remains explicit wherever automation requires confirmation.

## Capabilities and Constraints

- Company and personal Spaces are distinct ownership and access boundaries.
- Users and companies have a many-to-many membership relationship.
- Projects belong to a company or personal Space; Tasks and documents inherit
  project access rules.
- Document changes are versioned and auditable across Web, desktop, MCP, and
  system sources.
- Agent and Loop states must not replace Task state or fabricate delivery facts.
- Anonymous public pages must not load tenant data. Authenticated visitors to
  the root route are redirected to the Workbench.
- The public product page may use synthetic demonstration content, but it must
  not invent customer names, benchmarks, pricing, or unsupported capabilities.

## Brand Commitments

- Product name: HumanThread.
- Existing brand assets live under `apps/web/public/brand/`.
- Product language is concrete, operational, and oriented around visible next
  actions rather than abstract AI claims.
- Company and personal Space, Project, Task, Document, Agent, Loop, and human
  approval are first-class product terms.

## Evidence on Hand

- Working authenticated Web routes cover Spaces, projects, Tasks, documents,
  Agents, Loops, approvals, and delivery reports.
- The repository contains current product and architecture specifications under
  `docs/product/` and `docs/architecture/`.
- The existing public root route contains the correct four-part product map and
  session-safe redirect behavior.
- No customer logos, testimonials, independently verified performance
  benchmarks, or commercial proof assets are currently confirmed for public use.

## Product Principles

1. Keep company ownership, personal identity, and project membership explicit.
2. Preserve one Task truth across human and automated execution.
3. Make the next action, blocker, and approval state visible.
4. Keep documents and decisions attached to the delivery context that produced
   them.
5. Apply the same access and audit rules across Web, desktop, Agent, and MCP
   entry points.

## Accessibility & Inclusion

Public and authenticated Web surfaces must remain keyboard accessible, meet
WCAG AA contrast expectations, preserve readable content under zoom and narrow
viewports, and provide a static equivalent when reduced motion is requested.
