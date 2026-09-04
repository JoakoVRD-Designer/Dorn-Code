#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { z } from "zod";
import axios from "axios";

interface MotionSitesConfig {
  apiUrl: string;
  apiKey?: string;
  timeout: number;
}

const config: MotionSitesConfig = {
  apiUrl: process.env.MOTIONSITES_API_URL || "https://motionsites.ai",
  apiKey: process.env.MOTIONSITES_API_KEY,
  timeout: parseInt(process.env.MOTIONSITES_TIMEOUT || "30000"),
};

interface GenerateWebsiteParams {
  prompt: string;
  style?: string;
  duration?: number;
  theme?: "light" | "dark";
  includeNavigation?: boolean;
  responsiveDesign?: boolean;
}

interface GenerateWebsiteResult {
  success: boolean;
  url?: string;
  id?: string;
  preview?: string;
  status?: string;
  error?: string;
}

async function generateMotionWebsite(
  params: GenerateWebsiteParams
): Promise<GenerateWebsiteResult> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const response = await axios.post(
      `${config.apiUrl}/api/generate`,
      { ...params },
      {
        headers,
        timeout: config.timeout,
      }
    );

    return {
      success: true,
      url: response.data.url,
      id: response.data.id,
      preview: response.data.preview,
      status: response.data.status,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Error generating motion website:", errorMessage);
    return {
      success: false,
      error: `Failed to generate website: ${errorMessage}`,
    };
  }
}

async function getWebsiteStatus(
  id: string
): Promise<{ status: string; url?: string; error?: string }> {
  try {
    const headers: Record<string, string> = {};
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const response = await axios.get(`${config.apiUrl}/api/status/${id}`, {
      headers,
      timeout: config.timeout,
    });

    return {
      status: response.data.status,
      url: response.data.url,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      status: "error",
      error: `Failed to get status: ${errorMessage}`,
    };
  }
}

// Define Zod schemas for tool requests
const GenerateWebsiteRequestSchema = z.object({
  method: z.literal("tools/call"),
  params: z.object({
    name: z.literal("generate_motion_website"),
    arguments: z.object({
      prompt: z.string(),
      style: z.string().optional(),
      duration: z.number().optional(),
      theme: z.enum(["light", "dark"]).optional(),
      includeNavigation: z.boolean().optional(),
      responsiveDesign: z.boolean().optional(),
    }),
  }),
});

const CheckStatusRequestSchema = z.object({
  method: z.literal("tools/call"),
  params: z.object({
    name: z.literal("check_website_status"),
    arguments: z.object({
      id: z.string(),
    }),
  }),
});

const ListToolsRequestSchema = z.object({
  method: z.literal("tools/list"),
});

const server = new Server(
  {
    name: "motionsites-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handler for listing tools
server.setRequestHandler(
  ListToolsRequestSchema,
  async () => {
    return {
      tools: [
        {
          name: "generate_motion_website",
          description:
            "Generate a motion-based website from a text prompt using motionsites.ai",
          inputSchema: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description:
                  "The prompt describing the website to generate (e.g., 'impact-ventures')",
              },
              style: {
                type: "string",
                description:
                  "The style/template to use (e.g., 'minimal', 'corporate', 'creative')",
              },
              duration: {
                type: "number",
                description: "Duration of animations in seconds",
              },
              theme: {
                type: "string",
                enum: ["light", "dark"],
                description: "Color theme for the website",
              },
              includeNavigation: {
                type: "boolean",
                description: "Include navigation menu in the website",
              },
              responsiveDesign: {
                type: "boolean",
                description: "Make the website responsive for mobile devices",
              },
            },
            required: ["prompt"],
          },
        },
        {
          name: "check_website_status",
          description: "Check the status of a generated website",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "The website generation ID",
              },
            },
            required: ["id"],
          },
        },
      ],
    };
  }
);

// Handler for generating websites
server.setRequestHandler(
  GenerateWebsiteRequestSchema,
  async (request) => {
    const params = request.params.arguments;
    const result = await generateMotionWebsite(params as GenerateWebsiteParams);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// Handler for checking status
server.setRequestHandler(
  CheckStatusRequestSchema,
  async (request) => {
    const id = request.params.arguments.id;
    const result = await getWebsiteStatus(id);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Motionsites MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
