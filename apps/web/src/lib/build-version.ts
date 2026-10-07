import { formatBuildVersion } from "../../../../packages/shared/src/build-version";
import packageManifest from "../../package.json";

export const WEB_BUILD_VERSION = formatBuildVersion("Web", packageManifest.version, process.env.NEXT_PUBLIC_HUMANTHREAD_BUILD_REVISION);
