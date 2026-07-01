import logging
import json
import sys
from datetime import datetime, timezone

class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        }
        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)
        
        # Add structured extra data if provided
        if hasattr(record, "extra_data"):
            log_record.update(record.extra_data)
            
        return json.dumps(log_record)

def get_logger(name: str):
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    
    # Avoid adding duplicate handlers if the logger is imported multiple times
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        formatter = JSONFormatter()
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        
    return logger

class StructuredLogger:
    def __init__(self, name: str):
        self.logger = get_logger(name)

    def info(self, message: str, **kwargs):
        self.logger.info(message, extra={"extra_data": kwargs})

    def error(self, message: str, **kwargs):
        self.logger.error(message, extra={"extra_data": kwargs})

    def warning(self, message: str, **kwargs):
        self.logger.warning(message, extra={"extra_data": kwargs})
