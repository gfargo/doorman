# Examples & Getting Started

This directory contains example configurations and templates to help you get started with Doorman. Whether you're looking to use pre-built templates or create custom rules, you'll find everything you need here.

## Quick Start with Templates

The fastest way to get started is by using our built-in templates based on Vercel's official rule templates. Use the `template` command to add pre-configured rules to your configuration:

```bash
# List available templates
doorman template

# Add a specific template
doorman template wordpress    # Block WordPress-related URLs
doorman template ai-bots      # Block AI bot traffic
doorman template bad-bots     # Block known malicious bots
```

### Available Templates

- **Block Bad Bots** (`bad-bots`): Protect against common malicious bot traffic
- **Block AI Bots** (`ai-bots`): Prevent AI crawlers and scrapers
- **Block WordPress URLs** (`wordpress`): Deny access to common WordPress paths
- **Block OFAC Countries** (`block-ofac-sanctioned-countries`): Comply with OFAC sanctions

## Rule Structure

Each firewall rule in Doorman follows this structure:

```json
{
  "$schema": "https://doorman.griffen.codes/schema.json",
  "name": "Example Rule",
  "description": "Optional description of the rule",
  "conditionGroup": [
    {
      "conditions": [
        {
          "type": "path",
          "op": "pre",
          "value": "/api"
        }
      ]
    }
  ],
  "action": {
    "mitigate": {
      "action": "deny",
      "rateLimit": {
        "requests": 100,
        "window": "1m"
      },
      "actionDuration": "1h"
    }
  },
  "active": true
}
```

### Key Components

1. **Condition Groups**: Define when rules should trigger

   - Multiple conditions in a group use AND logic
   - Multiple groups use OR logic

2. **Conditions**: Specify matching criteria using `type`, `op`, and `value`

   Available Types (`type`):

   Request Properties:

   - `host`: Match request hostname
   - `path`: Match URL path
   - `method`: Match HTTP method
   - `header`: Match HTTP headers
   - `query`: Match query parameters
   - `cookie`: Match cookie values
   - `target_path`: Match target path
   - `protocol`: Match protocol
   - `scheme`: Match URL scheme

   Client Properties:

   - `ip_address`: Match IP addresses
   - `user_agent`: Match User-Agent strings
   - `ja4_digest`: Match JA4 fingerprint
   - `ja3_digest`: Match JA3 fingerprint

   Geographic Properties:

   - `geo_continent`: Match continents
   - `geo_country`: Match countries
   - `geo_country_region`: Match country regions
   - `geo_city`: Match cities
   - `geo_as_number`: Match Autonomous System Numbers

   Other:

   - `environment`: Match environment variables
   - `rate_limit_api_id`: Match rate limit API IDs
   - `region`: Match regions

   Operators (`op`):

   ```
   eq  -> Equals
   pre -> Starts with
   suf -> Ends with
   inc -> Is any of
   sub -> Contains
   re  -> Matches regex
   ex  -> Exists
   nex -> Does not exist
   ```

   The `neg` Property:
   Any condition can be inverted by adding `neg: true` to the condition object. The operator remains the same, but its logic is inverted. For example:

   ```json
   {
     "type": "path",
     "op": "pre", // Operator stays as "pre"
     "neg": true, // Adding neg:true inverts the condition
     "value": "/api"
   }
   ```

   This condition matches paths that do NOT start with "/api". The `pre` operator still means "starts with", but `neg: true` inverts the entire condition's logic.

3. **Actions**: Define the response

   - `deny`: Block the request
   - `challenge`: Present a browser challenge
   - `rateLimit`: Limit request frequency
   - `rewrite`: Modify the request

4. **Metadata**: Rule information
   - `name`: Unique identifier
   - `description`: Optional explanation
   - `active`: Enable/disable the rule

### Common Condition Patterns

```json
// Block paths starting with /wp-
{
  "type": "path",
  "op": "pre",
  "value": "/wp-"
}

// Block specific countries
{
  "type": "geo_country",
  "op": "inc",
  "value": ["CN", "RU"]
}

// Block all methods except GET and POST
{
  "type": "method",
  "op": "inc",
  "neg": true,
  "value": ["GET", "POST"]
}

// Block requests with specific User-Agent
{
  "type": "user_agent",
  "op": "sub",
  "value": "Bad-Bot/1.0"
}

// Match requests from IP range
{
  "type": "ip_address",
  "op": "inc",
  "value": ["192.168.1.0/24"]
}

// Block if header exists
{
  "type": "header",
  "op": "ex",
  "value": "x-bad-header"
}

// Match requests from specific continent
{
  "type": "geo_continent",
  "op": "eq",
  "value": "NA"
}

// Match using regex on path
{
  "type": "path",
  "op": "re",
  "value": "^/api/v[0-9]+/"
}

// Match specific cookie value
{
  "type": "cookie",
  "op": "eq",
  "key": "session",
  "value": "expired"
}
```

## Example Categories

### Basic Protection

- `ip-block.json` - Block specific IP addresses
- `path-protection.json` - Secure specific URL paths
- `geo-blocking.json` - Country-based access control
- `method-restriction.json` - Limit HTTP methods

### Advanced Security

- `rate-limiting.json` - Prevent abuse through rate limits
- `redirect-rules.json` - Traffic redirection examples
- `challenge-rules.json` - Bot prevention with challenges
- `conditional-rules.json` - Complex rule combinations

### Specialized Rules

- `user-agent-filtering.json` - Filter by browser/client type
- `header-based-rules.json` - Rules based on HTTP headers
- `mixed-rules.json` - Multiple protection layers

## Best Practices

1. **Start Simple**: Begin with basic rules and expand as needed
2. **Test First**: Use `--dry-run` when syncing new rules
3. **Monitor Impact**: Review logs after implementing new rules
4. **Layer Security**: Combine multiple rules for better protection
5. **Version Control**: Keep your config file in source control
