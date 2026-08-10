"""Deprecated module. Use db.database instead."""
import warnings
from db.database import PostgresDB, SupabaseDB

warnings.warn("db.supabase module is deprecated, use db.database instead.", DeprecationWarning, stacklevel=2)
