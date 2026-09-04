# Motionsites MCP Server

A Model Context Protocol (MCP) server for integrating [motionsites.ai](https://motionsites.ai) with Claude and other AI assistants.

## Overview

This MCP server allows Claude and other AI models to:
- Generate motion-based websites from text prompts
- Monitor the status of website generation
- Customize website properties (style, theme, duration, responsiveness)
- Access a fully managed API interface to motionsites.ai

## Installation

### Prerequisites
- Node.js 18+ 
- npm or yarn
- motionsites.ai API key (optional, for authenticated requests)

### Setup

1. Clone or download this repository
2. Install dependencies:
```bash
npm install
```

3. Build the TypeScript code:
```bash
npm run build
```

## Configuration

### Environment Variables

Set these environment variables to configure the MCP server:

- `MOTIONSITES_API_URL`: The motionsites.ai API endpoint (default: `https://motionsites.ai`)
- `MOTIONSITES_API_KEY`: Your API key for authenticated requests (optional)
- `MOTIONSITES_TIMEOUT`: Request timeout in milliseconds (default: `30000`)

### Claude Desktop Integration

1. Locate your Claude configuration file:
   - **macOS/Linux**: `~/.claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the motionsites MCP server configuration:

```json
{
  "mcpServers": {
    "motionsites": {
      "command": "node",
      "args": ["/path/to/motionsites-mcp/build/index.js"],
      "env": {
        "MOTIONSITES_API_URL": "https://motionsites.ai",
        "MOTIONSITES_API_KEY": "your-api-key-here",
        "MOTIONSITES_TIMEOUT": "30000"
      }
    }
  }
}
```

3. Restart Claude Desktop

## Available Tools

### `generate_motion_website`

Generate a motion-based website from a text prompt.

**Parameters:**
- `prompt` (string, required): Description of the website to generate
  - Example: `"impact-ventures"`, `"tech startup landing page"`, `"portfolio showcase"`
- `style` (string, optional): Template/style to use
  - Examples: `"minimal"`, `"corporate"`, `"creative"`, `"modern"`
- `duration` (number, optional): Duration of animations in seconds (1-30)
- `theme` (string, optional): Color theme - `"light"` or `"dark"`
- `includeNavigation` (boolean, optional): Include navigation menu (default: true)
- `responsiveDesign` (boolean, optional): Mobile-responsive design (default: true)

**Example:**
```
Generate a motion website with prompt: "impact-ventures", style: "modern", theme: "dark"
```

**Response:**
```json
{
  "success": true,
  "url": "https://motionsites.ai/sites/abc123",
  "id": "abc123",
  "preview": "https://motionsites.ai/preview/abc123.jpg",
  "status": "generating"
}
```

### `check_website_status`

Check the generation status of a website.

**Parameters:**
- `id` (string, required): The website generation ID

**Example:**
```
Check status of website ID: "abc123"
```

**Response:**
```json
{
  "status": "completed",
  "url": "https://motionsites.ai/sites/abc123"
}
```

## Usage Examples

### Example 1: Basic Website Generation
```
"Generate a motion website for an impact ventures company with a modern style"
```

Claude will use the `generate_motion_website` tool with:
- prompt: "impact ventures company"
- style: "modern"

### Example 2: Specific Design Requirements
```
"Create a dark-themed, mobile-responsive website for a tech startup with minimal animations"
```

Claude will use the tool with customized parameters for theme, responsiveness, and style.

### Example 3: Status Checking
```
"Check the status of the website generation with ID xyz789"
```

Claude will use the `check_website_status` tool to retrieve the current status.

## Development

### Build
```bash
npm run build
```

### Development Mode
```bash
npm run dev
```

### Watch Mode
```bash
npm run watch
```

## API Endpoint Details

The MCP server makes HTTP requests to the motionsites.ai API:

### Generate Website
- **Endpoint**: `POST /api/generate`
- **Headers**: Content-Type: application/json, Authorization: Bearer {API_KEY}
- **Body**: JSON with generation parameters

### Check Status
- **Endpoint**: `GET /api/status/{id}`
- **Headers**: Authorization: Bearer {API_KEY}

## Error Handling

The server handles various error conditions:
- Network timeouts (respects the MOTIONSITES_TIMEOUT setting)
- Invalid API responses
- Missing or expired API keys
- Malformed requests

All errors are returned as structured JSON responses with error messages.

## Troubleshooting

### Server won't start
- Ensure Node.js 18+ is installed: `node --version`
- Check that dependencies are installed: `npm install`
- Verify the build succeeded: `npm run build`

### Tool calls fail
- Check your API URL and key configuration
- Verify network connectivity to motionsites.ai
- Check Claude console for detailed error messages

### Timeout issues
- Increase `MOTIONSITES_TIMEOUT` environment variable
- Check your internet connection

## Security

- Store API keys securely (use environment variables, not in code)
- Never commit `.env` files or keys to version control
- Use HTTPS for all API communications
- Rotate API keys regularly if exposed

## License

MIT License - See LICENSE file for details

## Support

For issues or feature requests related to:
- **This MCP Server**: Check the GitHub repository
- **motionsites.ai**: Visit https://motionsites.ai or contact their support

## Version History

### 1.0.0 (2026-09-04)
- Initial release
- Support for website generation with customizable parameters
- Status checking functionality
- Full TypeScript implementation
- Claude Desktop integration guide
