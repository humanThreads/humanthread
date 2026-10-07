export type GitCommand = (args: string[]) => string;

export declare function assertReleaseSource(input?: {
  execGit?: GitCommand;
}): void;

export declare function assertDesktopReleaseSource(input?: {
  execGit?: GitCommand;
}): void;
