import { describe, expect, it } from "vitest";
import {
  computeInternalLabRuntimeDigest,
  describeDeploymentRuntimeIdentity,
} from "@/application/conversation-v2/internal-lab-approval";

const production = {
  nodeVersion: "v22.11.0",
  platform: "linux" as NodeJS.Platform,
  arch: "x64",
};

describe("deployment runtime identity", () => {
  it("reports the digest the approval must declare for that exact runtime", () => {
    const identity = describeDeploymentRuntimeIdentity(production);

    expect(identity.runtimeDigest).toBe(computeInternalLabRuntimeDigest(production));
    expect(identity).toMatchObject(production);
  });

  it("separates runtimes that differ only by patch version", () => {
    const other = describeDeploymentRuntimeIdentity({ ...production, nodeVersion: "v22.11.1" });

    expect(other.runtimeDigest).not.toBe(describeDeploymentRuntimeIdentity(production).runtimeDigest);
  });

  it("keeps a caller-supplied commit only when it is an exact object id", () => {
    expect(describeDeploymentRuntimeIdentity({ ...production, commit: "a".repeat(40) }).commit)
      .toBe("a".repeat(40));
    expect(describeDeploymentRuntimeIdentity({ ...production, commit: "not-a-sha" }).commit).toBeNull();
    expect(describeDeploymentRuntimeIdentity(production).commit).toBeNull();
  });

  it("exposes no field beyond runtime identity", () => {
    expect(Object.keys(describeDeploymentRuntimeIdentity(production)).sort())
      .toEqual(["arch", "commit", "nodeVersion", "platform", "runtimeDigest"]);
  });
});
