import { workbenchQueryKey } from "@humanthread/workbench-client";
import { useQuery } from "@tanstack/react-query";
import type { ZodType } from "zod";

import { useDesktopSession } from "../../session/session-provider";

type SearchValue = string | number | undefined;

export function buildDesktopReadModelPath(
  endpoint: string,
  spaceKey: string,
  parameters: Readonly<Record<string, SearchValue>> = {},
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) search.set(key, String(value));
  }
  search.set("space", spaceKey);
  return `${endpoint}?${search.toString()}`;
}

export function useDesktopReadModel<T>(input: {
  domain: string;
  endpoint: string;
  schema: ZodType<T>;
  parameters?: Readonly<Record<string, SearchValue>>;
}) {
  const session = useDesktopSession();
  const parameters = input.parameters ?? {};

  return useQuery({
    enabled: Boolean(session.client && session.context),
    queryKey: session.context
      ? workbenchQueryKey(session.context, input.domain, parameters)
      : ["desktop", input.domain, "disabled"],
    queryFn: async () => {
      if (!session.client || !session.context) throw new Error("桌面会话不可用");
      return session.client.request(
        buildDesktopReadModelPath(input.endpoint, session.context.spaceKey, parameters),
        input.schema,
      );
    },
  });
}
