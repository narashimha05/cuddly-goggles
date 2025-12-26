# DevChat Theme Quick Reference

## Quick Commands

```bash
/theme list              # See all themes
/theme switch            # Change theme
/theme preview dark      # Preview dark theme
/theme custom            # Create your own
/theme reset             # Back to default (no colors)
```

## Built-in Themes

- **default** - No colors (plain text)
- **dark** - For dark terminals
- **light** - For light terminals
- **ocean** - Blue/cyan colors
- **forest** - Green nature theme
- **sunset** - Purple/magenta
- **custom** - Your personalized theme

## What Gets Colored

- Usernames (@johndoe)
- Timestamps ([2 min ago])
- Success messages (✓)
- Error messages (✗)
- Info messages (ℹ)
- Warnings (⚠)
- Borders (━━━)
- Prompts (>)
- Highlights

## Where Colors Appear

- Inbox messages
- Message history
- Mail system
- Friend lists
- Reminders
- File sharing
- System notifications

## Common ANSI Codes

```
Red:     \x1b[31m    Bright Red:     \x1b[91m
Green:   \x1b[32m    Bright Green:   \x1b[92m
Yellow:  \x1b[33m    Bright Yellow:  \x1b[93m
Blue:    \x1b[34m    Bright Blue:    \x1b[94m
Magenta: \x1b[35m    Bright Magenta: \x1b[95m
Cyan:    \x1b[36m    Bright Cyan:    \x1b[96m
White:   \x1b[37m    Bright White:   \x1b[97m
Gray:    \x1b[90m    Bold:           \x1b[1m
```

## Tips

- Restart CLI after changing themes
- Use `/theme preview` before switching
- Dark themes for dark terminals
- Light themes for light terminals
- Empty string = no color for that element

## Files

- `cli/theme.json` - Theme storage
- `cli/THEME_GUIDE.md` - Full documentation
- `cli/THEME_IMPLEMENTATION.md` - Technical details

## Need Help?

```bash
/theme info    # Detailed customization info
/theme help    # Command help
```
