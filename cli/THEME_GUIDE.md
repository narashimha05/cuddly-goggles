# DevChat Theme Customization Guide

## Overview

DevChat now supports comprehensive theme customization, allowing you to personalize the appearance of the CLI interface with colors and styles.

## Quick Start

```bash
# View all available themes
/theme list

# Preview a theme before switching
/theme preview dark

# Switch to a theme
/theme switch

# Create your own custom theme
/theme custom

# Reset to default (no colors)
/theme reset
```

---

## What Can Be Customized?

The theme system applies colors to 9 different UI elements:

| Element     | Description                        | Example                   |
| ----------- | ---------------------------------- | ------------------------- |
| `username`  | User handles and names             | @johndoe                  |
| `timestamp` | Date/time information              | [2 minutes ago]           |
| `success`   | Success messages and confirmations | ✓ Message sent            |
| `error`     | Error messages and failures        | ✗ Login failed            |
| `info`      | Informational messages             | ℹ 5 new messages          |
| `warning`   | Warning and caution messages       | ⚠ Account will be deleted |
| `border`    | Separators and borders             | ━━━━━━━━━━━━━             |
| `prompt`    | Input prompts and questions        | > Enter command           |
| `highlight` | Important or emphasized text       | **Important**             |

---

## Where Are Themes Applied?

Themes affect color throughout the entire CLI:

- **Inbox** - Username colors, timestamps
- **Message History** - Sender names, message timestamps
- **Mail System** - From/To addresses, mail timestamps
- **Friend Lists** - Friend usernames
- **System Messages** - Success/error/info notifications
- **Reminders** - Reminder text and timestamps
- **File Sharing** - Shared by usernames

---

## Built-in Themes

### 1. **Default** (No Colors)

Plain text with no ANSI color codes. Best for terminals with limited color support or when you prefer minimal styling.

### 2. **Dark Theme**

Designed for dark terminal backgrounds with vibrant colors:

- Username: Cyan
- Success: Green
- Error: Red
- Info: Blue
- Warning: Yellow

### 3. **Light Theme**

Optimized for light terminal backgrounds with softer, brighter colors.

### 4. **Ocean Theme**

Blue and cyan inspired by the ocean:

- Username: Cyan
- Border: Blue
- Prompt: Bright Cyan

### 5. **Forest Theme**

Green nature-inspired palette:

- Username: Green
- Success: Bright Green
- Border: Green

### 6. **Sunset Theme**

Purple and magenta evening colors:

- Username: Magenta
- Border: Purple
- Prompt: Bright Magenta

### 7. **Custom**

Your personalized theme with user-defined colors.

---

## How to Create a Custom Theme

### Step 1: Start Custom Theme Wizard

```bash
/theme custom
```

### Step 2: Enter ANSI Color Codes

You'll be prompted for each UI element. Common ANSI codes:

| Color        | Normal     | Bright     |
| ------------ | ---------- | ---------- |
| Black (Gray) | `\x1b[30m` | `\x1b[90m` |
| Red          | `\x1b[31m` | `\x1b[91m` |
| Green        | `\x1b[32m` | `\x1b[92m` |
| Yellow       | `\x1b[33m` | `\x1b[93m` |
| Blue         | `\x1b[34m` | `\x1b[94m` |
| Magenta      | `\x1b[35m` | `\x1b[95m` |
| Cyan         | `\x1b[36m` | `\x1b[96m` |
| White        | `\x1b[37m` | `\x1b[97m` |

**Special Codes:**

- `\x1b[1m` - Bold
- `\x1b[4m` - Underline
- `\x1b[0m` - Reset (automatically added)

### Step 3: Preview Your Theme

```bash
/theme preview custom
```

### Step 4: Apply and Restart

Your custom theme is automatically activated. Restart the CLI to see full effects.

---

## Theme Configuration File

Themes are stored in `cli/theme.json`:

```json
{
  "currentTheme": "dark",
  "themes": {
    "dark": {
      "name": "Dark Theme",
      "username": "\u001b[36m",
      "timestamp": "\u001b[90m",
      "success": "\u001b[32m",
      "error": "\u001b[31m",
      "info": "\u001b[34m",
      "warning": "\u001b[33m",
      "border": "\u001b[90m",
      "prompt": "\u001b[35m",
      "highlight": "\u001b[1m\u001b[37m",
      "reset": "\u001b[0m"
    }
  }
}
```

### Manual Editing

You can manually edit `theme.json` to:

- Create new themes
- Modify existing themes
- Share themes with others

**Note:** After manual edits, use `/theme switch` to reload.

---

## Technical Implementation

### How It Works

1. **Startup**: Theme loaded from `theme.json` using `loadTheme()`
2. **Application**: `applyColor(text, colorType)` wraps text with ANSI codes
3. **Display**: Terminal interprets ANSI codes and renders colors
4. **Persistence**: Theme selection saved to `theme.json`

### Code Example

```javascript
// Apply username color
const username = applyColor(`@${user.username}`, "username");
console.log(username); // Outputs colored username

// Apply success message color
console.log(applyColor("✓ Operation successful", "success"));
```

### Function Reference

| Function           | Purpose                           |
| ------------------ | --------------------------------- |
| `loadTheme()`      | Load theme from config file       |
| `saveTheme()`      | Save theme configuration          |
| `applyColor()`     | Apply color to text               |
| `handleTheme()`    | Main theme command handler        |
| `listThemes()`     | Display all available themes      |
| `switchTheme()`    | Switch active theme               |
| `previewTheme()`   | Preview theme without applying    |
| `customizeTheme()` | Interactive custom theme creation |
| `resetTheme()`     | Reset to default (no colors)      |

---

## Customization Process

### 1. Planning Phase

- Determine your terminal background (dark/light)
- Choose a color scheme (monochrome, colorful, themed)
- Consider readability and contrast

### 2. Design Phase

- Test colors in your terminal
- Use `/theme preview` to see examples
- Iterate on color combinations

### 3. Implementation Phase

- Use `/theme custom` for guided setup
- Or manually edit `theme.json`
- Save and reload

### 4. Testing Phase

- Test with inbox messages
- Check message history
- Verify mail system colors
- Ensure all UI elements are visible

---

## Best Practices

### Color Selection

- **Contrast**: Ensure good contrast with background
- **Consistency**: Use related colors for similar elements
- **Accessibility**: Consider colorblind-friendly palettes
- **Readability**: Avoid overly bright or dim colors

### Theme Design

- **Purpose**: Dark themes for dark terminals, light for light
- **Hierarchy**: Important info (errors) should stand out
- **Harmony**: Colors should complement each other
- **Simplicity**: Don't use too many different colors

### Terminal Compatibility

- Not all terminals support all ANSI codes
- Test your theme in your specific terminal
- Use standard colors (30-37, 90-97) for best compatibility
- Bold (`\x1b[1m`) is widely supported

---

## Examples

### Minimalist Theme

```json
{
  "username": "\u001b[37m",
  "timestamp": "\u001b[90m",
  "success": "\u001b[32m",
  "error": "\u001b[31m",
  "info": "",
  "warning": "\u001b[33m",
  "border": "\u001b[90m",
  "prompt": "",
  "highlight": "\u001b[1m"
}
```

### High Contrast Theme

```json
{
  "username": "\u001b[1m\u001b[36m",
  "timestamp": "\u001b[90m",
  "success": "\u001b[1m\u001b[92m",
  "error": "\u001b[1m\u001b[91m",
  "info": "\u001b[1m\u001b[94m",
  "warning": "\u001b[1m\u001b[93m",
  "border": "\u001b[37m",
  "prompt": "\u001b[1m\u001b[95m",
  "highlight": "\u001b[1m\u001b[97m"
}
```

---

## Troubleshooting

### Colors Not Showing

- Check if your terminal supports ANSI colors
- Verify `theme.json` syntax is valid JSON
- Ensure ANSI codes are properly escaped
- Restart the CLI after theme changes

### Colors Look Wrong

- Verify terminal background color setting
- Test with different themes
- Check color codes are correct format
- Some terminals interpret colors differently

### Theme Not Persisting

- Ensure `theme.json` has write permissions
- Check file exists in `cli/` directory
- Verify JSON syntax is valid
- Use `/theme switch` after manual edits

### Reset Everything

```bash
/theme reset
```

This will restore the default theme (no colors).

---

## Advanced Tips

### RGB Colors (256-color terminals)

Some terminals support 256 colors:

```
\x1b[38;5;ColorNumberm  # Foreground
\x1b[48;5;ColorNumberm  # Background
```

Example: `\x1b[38;5;208m` (orange)

### True Color (24-bit terminals)

Modern terminals may support RGB:

```
\x1b[38;2;R;G;Bm  # Foreground RGB
\x1b[48;2;R;G;Bm  # Background RGB
```

Example: `\x1b[38;2;255;100;50m` (custom orange)

### Combining Styles

You can combine multiple codes:

```
\x1b[1m\x1b[36m  # Bold + Cyan
\x1b[4m\x1b[32m  # Underline + Green
```

### Sharing Themes

Export your custom theme:

```bash
# Copy your theme from theme.json
# Share with others
# They can paste into their theme.json
```

---

## Command Reference

| Command                 | Description                        |
| ----------------------- | ---------------------------------- |
| `/theme`                | Show theme help menu               |
| `/theme list`           | List all available themes          |
| `/theme current`        | Display current theme with preview |
| `/theme switch`         | Switch to different theme          |
| `/theme preview <name>` | Preview specific theme             |
| `/theme custom`         | Create/modify custom theme         |
| `/theme reset`          | Reset to default (no colors)       |
| `/theme info`           | Show detailed customization info   |

---

## FAQ

**Q: Do I need to restart for theme changes?**  
A: Yes, restart the CLI to see full theme effects throughout the interface.

**Q: Can I have different themes for different users?**  
A: Each CLI instance uses its own `theme.json`, so yes if running separate instances.

**Q: Will themes affect other users?**  
A: No, themes are local to your CLI and don't affect other users' views.

**Q: Can I use emoji in themes?**  
A: Emoji are displayed based on your terminal's emoji support, not theme settings.

**Q: What's the difference between \x1b and \u001b?**  
A: Both are ways to represent escape character - they're equivalent in JSON.

**Q: Can themes change font or size?**  
A: No, ANSI codes only affect colors and text styles (bold, underline), not fonts or sizes.

---

## Support

For issues or questions:

- Use `/theme info` for inline help
- Check this guide for detailed documentation
- Test with `/theme preview` before committing to a theme
- Reset with `/theme reset` if something goes wrong

Happy theming! 🎨
