variable "aws_region" {
  description = "The AWS region to deploy resources into"
  type        = string
  default     = "ap-southeast-1"
}

variable "project_name" {
  description = "Project name prefix for resources"
  type        = string
  default     = "react-aws-rum-poc"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"
}
