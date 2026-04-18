#!/bin/bash
source venv/bin/activate
export AURORA_ANALYST_MODE=resilient_dev
python senior_analyst_agent.py
