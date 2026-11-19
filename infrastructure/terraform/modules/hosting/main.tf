# Static hosting for the web app on AWS Amplify, using manual deployments:
# no Git repository or access token is needed. scripts/aws/deploy-web.mjs
# uploads each build.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

locals {
  content_security_policy = join("; ", [
    "default-src 'self'",
    "script-src 'self'",
    # Motion animates with inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' ${join(" ", var.connect_src)}",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ])
}

resource "aws_amplify_app" "web" {
  name     = var.app_name
  platform = "WEB"

  # Single-page app: unknown paths (/party, /tv, /admin, /doctor/...) serve index.html.
  custom_rule {
    source = "</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|avif|webmanifest)$)([^.]+$)/>"
    target = "/index.html"
    status = "200"
  }

  # Amplify accepts the documented YAML (customHeaders: ...) but stores the
  # list as JSON, so a YAML value shows up as a change in every plan. This is
  # the stored form, which keeps plans clean. Order is irrelevant to Amplify;
  # jsonencode sorts keys the same way Amplify returns them.
  custom_headers = jsonencode([
    {
      pattern = "**"
      headers = [
        { key = "Content-Security-Policy", value = local.content_security_policy },
        { key = "Strict-Transport-Security", value = "max-age=31536000; includeSubDomains" },
        { key = "X-Content-Type-Options", value = "nosniff" },
        { key = "X-Frame-Options", value = "DENY" },
        { key = "Referrer-Policy", value = "no-referrer" },
        { key = "Permissions-Policy", value = "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
      ]
    },
    {
      # Vite fingerprints asset file names, so they can be cached forever.
      pattern = "/assets/**"
      headers = [{ key = "Cache-Control", value = "public, max-age=31536000, immutable" }]
    },
  ])
}

resource "aws_amplify_branch" "main" {
  app_id            = aws_amplify_app.web.id
  branch_name       = var.branch_name
  stage             = var.stage
  framework         = "React"
  enable_auto_build = false
}
