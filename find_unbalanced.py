with open('index.html', 'r', encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        if line.count('(') > line.count(')'):
            print(f"Line {i}: More ( than ) -> {line.strip()}")
        if line.count(')') > line.count('('):
            print(f"Line {i}: More ) than ( -> {line.strip()}")
        if line.count('{') > line.count('}'):
            print(f"Line {i}: More {{ than }} -> {line.strip()}")
        if line.count('}') > line.count('{'):
            print(f"Line {i}: More }} than {{ -> {line.strip()}")
