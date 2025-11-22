def convert_time(time_str: str) -> int:
    """
    Convert "HH:MM" string to seconds since midnight.
    Example: "13:01" -> 13*3600 + 1*60 = 46860
    """
    if not time_str:
        return 0
    try:
        parts = time_str.split(":")
        hours = int(parts[0])
        minutes = int(parts[1])
        return hours * 3600 + minutes * 60
    except Exception as e:
        print(f"[WARN] Failed to convert time '{time_str}': {e}")
        return 0
