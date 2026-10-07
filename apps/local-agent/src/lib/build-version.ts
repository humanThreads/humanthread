import { formatBuildVersion } from "@humanthread/shared";

export const AGENT_BUILD_VERSION = formatBuildVersion("Desktop", __HUMANTHREAD_AGENT_VERSION__, __HUMANTHREAD_BUILD_REVISION__);
