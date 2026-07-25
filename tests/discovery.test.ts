import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { DiscoveryError, SkillsApi, parseCliSearch } from "../src/discovery.js";

describe("discovery adapters", () => {
  it("parses and deduplicates official CLI search output", () => {
    const output = `
      vercel-labs/agent-skills@react-best-practices
      vercel-labs/agent-skills@react-best-practices
      expo/skills@react-native
    `;
    expect(parseCliSearch(output, "react")).toHaveLength(2);
  });

  it("rejects a non-allowlisted API origin before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const config = parseConfig({
      discovery: {
        api_base_url: "https://evil.example",
        discovery_origins: ["https://skills.sh"],
      },
    });
    const api = new SkillsApi(config, fetchMock);

    await expect(api.search("react")).rejects.toBeInstanceOf(DiscoveryError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates the API search response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "vercel-labs/skills/react",
              slug: "react",
              name: "React",
              source: "vercel-labs/skills",
              installUrl: "https://github.com/vercel-labs/skills",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const api = new SkillsApi(parseConfig({}), fetchMock);
    await expect(api.search("react")).resolves.toEqual([
      expect.objectContaining({ id: "vercel-labs/skills/react", query: "react" }),
    ]);
  });

  it("retries a bounded transient API failure", async () => {
    const data = {
      data: [
        {
          id: "vercel-labs/skills/react",
          slug: "react",
          name: "React",
          source: "vercel-labs/skills",
          installUrl: "https://github.com/vercel-labs/skills",
        },
      ],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("unavailable", {
          status: 503,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(data), { status: 200 }));

    await expect(
      new SkillsApi(parseConfig({}), fetchMock).search("react"),
    ).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
