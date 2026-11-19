import os

from langchain_core.tools import tool

try:
    from e2b_code_interpreter import Sandbox
except ImportError:
    try:
        from e2b import Sandbox
    except ImportError:
        Sandbox = None


@tool
def run_python_code(code: str) -> str:
    """Executes a Python code block in a sandboxed, secure environment and returns the stdout/stderr.

    Use this tool when:
    - Resolving mathematical equations or complex calculations.
    - Testing Python code logic or verifying coding puzzle outputs.
    - Performing data manipulation or algorithmic validation.

    Do NOT use this tool when:
    - The user simply asks you to write code without needing to see it run.
    - The question is conceptual and does not benefit from code execution.

    Args:
        code: A valid string containing the Python code block to execute.

    Returns:
        A string containing the stdout/stderr of the execution or the error message.
    """
    api_key = os.getenv("E2B_API_KEY", "").strip()
    if not api_key:
        return f"Mock execution output for code: {code[:30]}..."

    if Sandbox is None:
        return "Error: e2b sandbox package is not installed. Code execution sandbox is unavailable."

    try:
        with Sandbox(api_key=api_key) as sandbox:
            execution = sandbox.run_code(code, timeout=30)
            if getattr(execution, "error", None):
                err = execution.error
                err_name = getattr(err, "name", "ExecutionError")
                err_val = getattr(err, "value", str(err))
                return f"Error: {err_name}: {err_val}"

            outputs = []
            logs = getattr(execution, "logs", None)
            if logs:
                for line in getattr(logs, "stdout", []):
                    outputs.append(str(line))
                for line in getattr(logs, "stderr", []):
                    outputs.append(str(line))

            for res in getattr(execution, "results", []):
                text = getattr(res, "text", None)
                if text:
                    outputs.append(str(text))

            combined = "\n".join(outputs).strip()
            return combined if combined else "Code executed successfully with no output."
    except Exception as exc:  # noqa: BLE001
        return f"Error executing code in sandbox: {exc}"
