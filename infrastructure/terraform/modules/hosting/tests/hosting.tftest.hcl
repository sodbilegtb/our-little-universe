mock_provider "aws" {
  mock_resource "aws_amplify_app" {
    defaults = { default_domain = "d1example.amplifyapp.com" }
  }
}

variables {
  app_name    = "olu-test"
  connect_src = ["https://*.execute-api.eu-central-1.amazonaws.com"]
}

run "security_headers_and_spa" {
  command = apply

  assert {
    condition     = output.url == "https://main.d1example.amplifyapp.com"
    error_message = "The app URL is the main branch on the Amplify domain."
  }

  assert {
    condition     = strcontains(aws_amplify_app.web.custom_headers, "connect-src 'self' https://*.execute-api.eu-central-1.amazonaws.com")
    error_message = "The CSP only allows calls to the app itself and the API."
  }

  assert {
    condition     = strcontains(aws_amplify_app.web.custom_headers, "script-src 'self'") && strcontains(aws_amplify_app.web.custom_headers, "frame-ancestors 'none'")
    error_message = "No third-party scripts, no framing."
  }

  assert {
    condition     = length(yamldecode(aws_amplify_app.web.custom_headers).customHeaders) == 2
    error_message = "The headers use the documented spec (a top-level customHeaders key): creating an app refuses anything else."
  }

  assert {
    condition     = strcontains(aws_amplify_app.web.custom_headers, "Strict-Transport-Security")
    error_message = "HSTS must be set."
  }

  assert {
    condition     = one(aws_amplify_app.web.custom_rule).target == "/index.html" && one(aws_amplify_app.web.custom_rule).status == "200"
    error_message = "Deep links (/party, /tv) must serve the app."
  }

  assert {
    condition     = aws_amplify_branch.main.enable_auto_build == false
    error_message = "Manual deployments only (no Git connection)."
  }
}
