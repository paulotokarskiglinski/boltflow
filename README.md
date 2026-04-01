# ⚡ Boltflow

**Boltflow** is a developer tool that generates interactive, self-contained visualizations of your application's component architecture. Run a single command and get a diagram showing every route, component, module, service, directive, pipe, and guard.

> Currently supports **Angular**.

## Installation

```bash
npm install -g boltflow
```

Or run without installing:

```bash
npx boltflow analyze ./my-app
```

## Usage

```bash
boltflow analyze [projectPath] [options]
```

If `projectPath` is omitted, the current directory is used.

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `-f, --format <format>` | `html` | Output format: `html` \| `json` \| `md` \| `both` \| `all` |
| `-o, --output <path>` | `boltflow-output` | Output file path (without extension) |
| `-c, --config <path>` | `tsconfig.json` | Path to `tsconfig.json`, relative to the project root |
| `--open` | `false` | Open the HTML output in the browser after generation |

### Output formats

| Format | Output | Description |
|--------|--------|-------------|
| `html` | `.html` | Interactive self-contained diagram (default) |
| `json` | `.json` | Raw graph data |
| `md` | `.md` | Markdown file with a flowchart diagram |
| `both` | `.html` + `.json` | HTML and JSON together |
| `all` | `.html` + `.json` + `.md` | All three formats |

## Examples

```bash
# Analyze the current directory, open in browser
boltflow analyze --open

# Analyze a specific project, save to a custom path
boltflow analyze ./my-app -o reports/architecture

# Generate all output formats
boltflow analyze ./my-app --format all

# Use a non-default tsconfig
boltflow analyze ./my-app --config tsconfig.app.json
```

## License

MIT
