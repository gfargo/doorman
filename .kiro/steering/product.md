# Product Overview

Doorman is a CLI tool for managing firewall rules as code across multiple providers. It enables Infrastructure as Code (IaC) approach for security configuration, allowing teams to version control, validate, and automate deployment of firewall rules.

## Supported Providers

- **Vercel Firewall** (stable) — full CRUD, sync, validation, templates
- **Cloudflare WAF** (beta) — rulesets, rules, Lists API, rule translation
- **Fastly Next-Gen WAF** (beta) — workspace rules, IP lists, rule translation (classic VCL services are out of scope — Next-Gen WAF's structured rules API only)

## Core Features

- **Multi-Provider Support**: Manage Vercel, Cloudflare, and Fastly firewalls through a unified CLI
- **Rule Management**: Create, update, delete, and sync firewall rules
- **Configuration as Code**: JSON-based configuration with schema validation
- **Template System**: Pre-built rule templates for common security patterns (AI bots, bad bots, WordPress protection, OFAC sanctions)
- **Validation**: Built-in configuration validation to prevent deployment errors
- **CI/CD Integration**: Designed for automated deployment pipelines with beta channel support
- **Dual Rule Types**: Supports both custom firewall rules and IP blocking rules
- **Rule Translation**: Bidirectional translation between each provider's format and the unified format

## Target Users

- DevOps engineers managing Vercel, Cloudflare, or Fastly deployments
- Security teams implementing firewall policies across providers
- Development teams needing automated security rule deployment
