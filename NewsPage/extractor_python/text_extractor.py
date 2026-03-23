import sys
from trafilatura import fetch_url, extract
import json

def main():
    url = sys.argv[1]
    downloaded = fetch_url(url)
    if downloaded:
        text = extract(downloaded)
        print(json.dumps({"text": text}))
    else:
        print(json.dumps({"text": ""}))

if __name__ == "__main__":
    main()