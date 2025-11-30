import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { z } from "zod";

// GitHub API configuration
const GITHUB_API_URL = "https://api.github.com";
const REPO_OWNER = "PeterBowles";
const REPO_NAME = "Macro_Tracker";
const FILE_PATH = "data.json";
const BRANCH = "main";

// Get GitHub token from environment
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error("Error: GITHUB_TOKEN environment variable is required");
  process.exit(1);
}

// Initialize MCP server
const server = new McpServer({
  name: "macro-tracker-mcp-server",
  version: "1.0.0"
});

// Type definitions for data structure
interface FoodEntry {
  time: string;
  description: string;
  calories: number;
  protein: number;
}

interface DayLog {
  date: string;
  entries: FoodEntry[];
}

interface MacroData {
  goals: {
    calories: number;
    protein: number;
  };
  log: DayLog[];
}

interface GitHubFile {
  sha: string;
  content: string;
  encoding: string;
}

// Helper function to make GitHub API requests
async function githubRequest<T>(
  endpoint: string,
  method: string = "GET",
  body?: any
): Promise<T> {
  const url = `${GITHUB_API_URL}${endpoint}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "macro-tracker-mcp-server"
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<T>;
}

// Helper function to read data from GitHub
async function readDataFromGitHub(): Promise<MacroData> {
  const fileData = await githubRequest<GitHubFile>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
    "GET"
  );

  const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
  return JSON.parse(content);
}

// Helper function to write data to GitHub
async function writeDataToGitHub(data: MacroData, commitMessage: string): Promise<void> {
  // Get current file to get its SHA
  const currentFile = await githubRequest<GitHubFile>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
    "GET"
  );

  // Convert data to base64
  const newContent = JSON.stringify(data, null, 2);
  const base64Content = Buffer.from(newContent).toString('base64');

  // Update the file
  await githubRequest<any>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
    "PUT",
    {
      message: commitMessage,
      content: base64Content,
      sha: currentFile.sha,
      branch: BRANCH
    }
  );
}

// Schema for reading data
const ReadDataInputSchema = z.object({}).strict();

// Schema for adding food entry
const AddFoodEntryInputSchema = z.object({
  date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Date in YYYY-MM-DD format"),
  time: z.string()
    .regex(/^\d{2}:\d{2}$/)
    .describe("Time in HH:MM format (24-hour)"),
  description: z.string()
    .min(1)
    .max(500)
    .describe("Description of the food eaten"),
  calories: z.number()
    .int()
    .min(0)
    .describe("Total calories for this entry"),
  protein: z.number()
    .min(0)
    .describe("Total protein in grams for this entry")
}).strict();

type AddFoodEntryInput = z.infer<typeof AddFoodEntryInputSchema>;

// Schema for updating food entry
const UpdateFoodEntryInputSchema = z.object({
  date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Date in YYYY-MM-DD format"),
  entryIndex: z.number()
    .int()
    .min(0)
    .describe("Index of the entry to update (0-based)"),
  time: z.string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .describe("New time in HH:MM format (24-hour)"),
  description: z.string()
    .min(1)
    .max(500)
    .optional()
    .describe("New description of the food"),
  calories: z.number()
    .int()
    .min(0)
    .optional()
    .describe("New calories value"),
  protein: z.number()
    .min(0)
    .optional()
    .describe("New protein value in grams")
}).strict();

type UpdateFoodEntryInput = z.infer<typeof UpdateFoodEntryInputSchema>;

// Schema for deleting food entry
const DeleteFoodEntryInputSchema = z.object({
  date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Date in YYYY-MM-DD format"),
  entryIndex: z.number()
    .int()
    .min(0)
    .describe("Index of the entry to delete (0-based)")
}).strict();

type DeleteFoodEntryInput = z.infer<typeof DeleteFoodEntryInputSchema>;

// Register tool to read current data
server.registerTool(
  "read_macro_data",
  {
    title: "Read Macro Tracker Data",
    description: `Read the current contents of data.json from the GitHub repository.

Returns the complete macro tracking data including goals and all food entries.

This is useful to check current data before adding, updating, or deleting entries.`,
    inputSchema: ReadDataInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async () => {
    try {
      const data = await readDataFromGitHub();
      return {
        content: [{
          type: "text" as const,
          text: `Current macro tracking data:\n\n${JSON.stringify(data, null, 2)}`
        }],
        structuredContent: data as unknown as { [x: string]: unknown }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: "text" as const,
          text: `Error reading data: ${errorMessage}`
        }],
        isError: true
      };
    }
  }
);

// Register tool to add food entry
server.registerTool(
  "add_food_entry",
  {
    title: "Add Food Entry",
    description: `Add a new food entry to the macro tracker.

Creates a new entry with the specified date, time, description, calories, and protein.
If the date doesn't exist in the log, it will be created automatically.
Changes are committed to GitHub.

Args:
  - date (string): Date in YYYY-MM-DD format
  - time (string): Time in HH:MM format (24-hour)
  - description (string): What was eaten
  - calories (number): Total calories
  - protein (number): Total protein in grams

Returns:
  Success message with the added entry details

Example:
  date: "2025-11-29"
  time: "14:30"
  description: "Grilled chicken breast with rice"
  calories: 450
  protein: 35`,
    inputSchema: AddFoodEntryInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: AddFoodEntryInput) => {
    try {
      const data = await readDataFromGitHub();

      const newEntry: FoodEntry = {
        time: params.time,
        description: params.description,
        calories: params.calories,
        protein: params.protein
      };

      // Find or create the day entry
      let dayLog = data.log.find(d => d.date === params.date);

      if (dayLog) {
        // Add to existing day
        dayLog.entries.push(newEntry);
      } else {
        // Create new day entry
        dayLog = {
          date: params.date,
          entries: [newEntry]
        };
        data.log.push(dayLog);
        // Sort log by date descending
        data.log.sort((a, b) => b.date.localeCompare(a.date));
      }

      const commitMessage = `Add food entry: ${params.description} (${params.date} ${params.time})`;
      await writeDataToGitHub(data, commitMessage);

      return {
        content: [{
          type: "text" as const,
          text: `Successfully added food entry!\n\nDate: ${params.date}\nTime: ${params.time}\nDescription: ${params.description}\nCalories: ${params.calories}\nProtein: ${params.protein}g\n\nCommitted to GitHub.`
        }],
        structuredContent: {
          success: true,
          entry: newEntry,
          date: params.date
        } as unknown as { [x: string]: unknown }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: "text" as const,
          text: `Error adding food entry: ${errorMessage}`
        }],
        isError: true
      };
    }
  }
);

// Register tool to update food entry
server.registerTool(
  "update_food_entry",
  {
    title: "Update Food Entry",
    description: `Update an existing food entry.

Modifies one or more fields of an existing entry. Only the fields you specify will be updated.
Changes are committed to GitHub.

Args:
  - date (string): Date in YYYY-MM-DD format
  - entryIndex (number): Index of the entry to update (0-based, use read_macro_data to see indices)
  - time (string, optional): New time in HH:MM format
  - description (string, optional): New description
  - calories (number, optional): New calories value
  - protein (number, optional): New protein value

Returns:
  Success message with updated entry details

Example:
  date: "2025-11-29"
  entryIndex: 0
  calories: 500
  protein: 30`,
    inputSchema: UpdateFoodEntryInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: UpdateFoodEntryInput) => {
    try {
      const data = await readDataFromGitHub();

      const dayLog = data.log.find(d => d.date === params.date);

      if (!dayLog) {
        throw new Error(`No entries found for date ${params.date}`);
      }

      if (params.entryIndex >= dayLog.entries.length) {
        throw new Error(`Entry index ${params.entryIndex} is out of range. Day has ${dayLog.entries.length} entries.`);
      }

      const entry = dayLog.entries[params.entryIndex];

      // Update only provided fields
      if (params.time !== undefined) entry.time = params.time;
      if (params.description !== undefined) entry.description = params.description;
      if (params.calories !== undefined) entry.calories = params.calories;
      if (params.protein !== undefined) entry.protein = params.protein;

      const commitMessage = `Update food entry: ${entry.description} (${params.date})`;
      await writeDataToGitHub(data, commitMessage);

      return {
        content: [{
          type: "text" as const,
          text: `Successfully updated entry!\n\nDate: ${params.date}\nEntry Index: ${params.entryIndex}\nUpdated Entry:\n  Time: ${entry.time}\n  Description: ${entry.description}\n  Calories: ${entry.calories}\n  Protein: ${entry.protein}g\n\nCommitted to GitHub.`
        }],
        structuredContent: {
          success: true,
          entry,
          date: params.date,
          entryIndex: params.entryIndex
        } as unknown as { [x: string]: unknown }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: "text" as const,
          text: `Error updating food entry: ${errorMessage}`
        }],
        isError: true
      };
    }
  }
);

// Register tool to delete food entry
server.registerTool(
  "delete_food_entry",
  {
    title: "Delete Food Entry",
    description: `Delete an existing food entry.

Removes an entry from the specified date. If this is the last entry for that date, the entire day will be removed from the log.
Changes are committed to GitHub.

Args:
  - date (string): Date in YYYY-MM-DD format
  - entryIndex (number): Index of the entry to delete (0-based, use read_macro_data to see indices)

Returns:
  Success message with deleted entry details

Example:
  date: "2025-11-29"
  entryIndex: 0`,
    inputSchema: DeleteFoodEntryInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params: DeleteFoodEntryInput) => {
    try {
      const data = await readDataFromGitHub();

      const dayLog = data.log.find(d => d.date === params.date);

      if (!dayLog) {
        throw new Error(`No entries found for date ${params.date}`);
      }

      if (params.entryIndex >= dayLog.entries.length) {
        throw new Error(`Entry index ${params.entryIndex} is out of range. Day has ${dayLog.entries.length} entries.`);
      }

      const deletedEntry = dayLog.entries[params.entryIndex];
      dayLog.entries.splice(params.entryIndex, 1);

      // If no entries left for this day, remove the day from log
      if (dayLog.entries.length === 0) {
        const dayIndex = data.log.indexOf(dayLog);
        data.log.splice(dayIndex, 1);
      }

      const commitMessage = `Delete food entry: ${deletedEntry.description} (${params.date})`;
      await writeDataToGitHub(data, commitMessage);

      return {
        content: [{
          type: "text" as const,
          text: `Successfully deleted entry!\n\nDate: ${params.date}\nEntry Index: ${params.entryIndex}\nDeleted Entry:\n  Time: ${deletedEntry.time}\n  Description: ${deletedEntry.description}\n  Calories: ${deletedEntry.calories}\n  Protein: ${deletedEntry.protein}g\n\nCommitted to GitHub.`
        }],
        structuredContent: {
          success: true,
          deletedEntry,
          date: params.date,
          entryIndex: params.entryIndex
        } as unknown as { [x: string]: unknown }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: "text" as const,
          text: `Error deleting food entry: ${errorMessage}`
        }],
        isError: true
      };
    }
  }
);

// Run server with HTTP transport
async function runHTTP() {
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || '7870');
  app.listen(port, () => {
    console.error(`Macro Tracker MCP server running on http://localhost:${port}/mcp`);
    console.error(`Repository: ${REPO_OWNER}/${REPO_NAME}`);
    console.error(`File: ${FILE_PATH}`);
  });
}

// Run server with stdio transport
async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Macro Tracker MCP server running on stdio");
  console.error(`Repository: ${REPO_OWNER}/${REPO_NAME}`);
  console.error(`File: ${FILE_PATH}`);
}

// Choose transport based on environment
const transport = process.env.TRANSPORT || 'http';
if (transport === 'http') {
  runHTTP().catch(error => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch(error => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
