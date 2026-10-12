import { describe, expect, it } from "vitest";

import {
  OFFICIAL_CLIENT_DOWNLOAD_URL,
  isPrivateDeploymentSite,
  resolveClientDownloadHref,
  resolveClientDownloadRedirect,
} from "./workbench-client-download";

describe("workbench client download link", () => {
  it("keeps the in-app catalog on the official deployment", () => {
    expect(isPrivateDeploymentSite("https://www.humanthread.cn")).toBe(false);
    expect(resolveClientDownloadHref("https://www.humanthread.cn")).toBe("/downloads");
  });

  it("sends private deployments to the official site catalog", () => {
    expect(isPrivateDeploymentSite("https://ht.example.com")).toBe(true);
    expect(isPrivateDeploymentSite("http://192.168.10.20:4322")).toBe(true);
    expect(resolveClientDownloadHref("https://ht.example.com")).toBe(
      OFFICIAL_CLIENT_DOWNLOAD_URL,
    );
    expect(resolveClientDownloadHref("http://192.168.10.20:4322")).toBe(
      OFFICIAL_CLIENT_DOWNLOAD_URL,
    );
  });

  it("treats an unknown or invalid deployment address as private", () => {
    // A private deployment that has not configured its public address must not
    // advertise an empty or broken release catalog of its own.
    expect(isPrivateDeploymentSite(null)).toBe(true);
    expect(isPrivateDeploymentSite("")).toBe(true);
    expect(isPrivateDeploymentSite("not-a-url")).toBe(true);
    expect(resolveClientDownloadHref(undefined)).toBe(OFFICIAL_CLIENT_DOWNLOAD_URL);
  });

  it("ignores paths, ports and case when matching the official host", () => {
    expect(isPrivateDeploymentSite("https://WWW.HumanThread.cn/")).toBe(false);
    expect(isPrivateDeploymentSite("https://www.humanthread.cn:443")).toBe(false);
    expect(isPrivateDeploymentSite("https://mirror.humanthread.cn")).toBe(true);
  });

  it("redirects a directly requested private catalog to the official site", () => {
    expect(resolveClientDownloadRedirect("https://ht.example.com")).toBe(
      OFFICIAL_CLIENT_DOWNLOAD_URL,
    );
    expect(resolveClientDownloadRedirect("https://www.humanthread.cn")).toBeNull();
    expect(resolveClientDownloadRedirect(null)).toBe(OFFICIAL_CLIENT_DOWNLOAD_URL);
  });
});
