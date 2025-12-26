# Publishing DevChat CLI to npm

## Prerequisites

1. **npm account**: Create at https://www.npmjs.com/signup
2. **Node.js**: Version 14 or higher

## Steps to Publish

### 1. Login to npm

```bash
npm login
```

Enter your npm username, password, and email.

### 2. Test Locally First

```bash
cd cli
npm link
```

Now you can test `devchat` command globally on your machine.

### 3. Update package.json

- Change `author` to your name
- Update `repository.url` if different
- Verify version number (start with 1.0.0)

### 4. Publish to npm

```bash
cd cli
npm publish
```

That's it! Your package is now live at `https://www.npmjs.com/package/devchat-cli`

## Installing Your Package

Users can now install globally:

```bash
npm install -g devchat-cli
```

Then use from anywhere:

```bash
devchat
```

## Updating Your Package

After making changes:

```bash
# Update version in package.json (e.g., 1.0.0 → 1.0.1)
npm version patch  # or minor, or major

# Publish update
npm publish
```

Users update with:

```bash
npm update -g devchat-cli
```

## Version Guidelines

- **Patch** (1.0.0 → 1.0.1): Bug fixes
- **Minor** (1.0.0 → 1.1.0): New features, backward compatible
- **Major** (1.0.0 → 2.0.0): Breaking changes

## Unpublishing (If Needed)

```bash
# Unpublish specific version
npm unpublish devchat-cli@1.0.0

# Unpublish entire package (only within 72 hours)
npm unpublish devchat-cli --force
```

## Check Package Name Availability

```bash
npm view devchat-cli
```

If taken, choose a different name in package.json like:

- `@your-username/devchat`
- `devchat-terminal`
- `dev-chat-cli`

## Scoped Packages (Alternative)

Use your npm username as scope:

```json
{
  "name": "@your-username/devchat"
}
```

Publish with:

```bash
npm publish --access public
```

Install with:

```bash
npm install -g @your-username/devchat
```

## Testing Before Publishing

```bash
# Pack into tarball
npm pack

# This creates devchat-cli-1.0.0.tgz
# Install from tarball to test
npm install -g ./devchat-cli-1.0.0.tgz
```

## Best Practices

1. ✅ Test with `npm link` first
2. ✅ Update version for each publish
3. ✅ Write clear README
4. ✅ Add keywords for discoverability
5. ✅ Include license
6. ✅ Test on Windows, Mac, Linux if possible

## Troubleshooting

**"Package name already taken"**

- Choose a different name
- Or use scoped package: `@your-username/devchat`

**"Permission denied"**

- Run `npm login` first
- Check you're logged in: `npm whoami`

**"Package.json invalid"**

- Validate JSON syntax
- Ensure all required fields present

**"Version already published"**

- Increment version: `npm version patch`
- Can't republish same version

## Making It Popular

1. Add badges to README:

   - npm version
   - downloads
   - license

2. Share on:

   - Twitter/X
   - Reddit r/node
   - Dev.to
   - Product Hunt

3. Add to GitHub topics:
   - cli
   - chat
   - nodejs

---

## Quick Checklist

- [ ] Tested with `npm link`
- [ ] Updated author name
- [ ] Verified package name available
- [ ] Logged in to npm
- [ ] Version is correct
- [ ] README is clear
- [ ] Ready to run `npm publish`

**Ready?** Run: `npm publish`
