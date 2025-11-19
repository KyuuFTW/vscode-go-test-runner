# Integration Testing Guide - VSCode Go Test Runner Extension

### Create .vsix File

```bash
# Install vsce globally (if not already)
npm install -g @vscode/vsce

# Package the extension
vsce package

# This creates: go-test-runner-0.1.0.vsix
```

### Install .vsix Locally

```bash
# Install from command line
code --install-extension go-test-runner-0.1.0.vsix

# Or via VSCode UI:
# Extensions view → ... menu → Install from VSIX
```
