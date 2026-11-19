mock_provider "aws" {
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:eu-central-1:123456789012:olu-test-alarms" }
  }
}

variables {
  name          = "olu-test"
  function_name = "olu-test-api"
  api_id        = "abc123"
}

run "budget_and_alarms" {
  command = apply

  variables {
    budget_email = "budget@example.com"
    alarm_email  = "alarms@example.com"
  }

  assert {
    condition     = length(aws_budgets_budget.monthly) == 1 && aws_budgets_budget.monthly[0].limit_amount == "10"
    error_message = "A 10 USD monthly budget alert is created."
  }

  assert {
    condition     = length(aws_sns_topic_subscription.email) == 1
    error_message = "Alarm emails are subscribed."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.lambda_errors.threshold == 0 && aws_cloudwatch_metric_alarm.api_5xx.dimensions["Stage"] == "$default"
    error_message = "Alarms watch the right metrics."
  }
}

run "no_emails_configured" {
  command = apply

  assert {
    condition     = length(aws_budgets_budget.monthly) == 0 && length(aws_sns_topic_subscription.email) == 0
    error_message = "Without emails, nothing tries to send mail."
  }
}
