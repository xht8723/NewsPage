import sys
from trafilatura import fetch_url, extract
import json

def main():
    url = sys.argv[1]
    downloaded = fetch_url(url)
    if downloaded:
        print("Download successful, attempting extraction...")
        text = extract(downloaded)
        if text:
            print(json.dumps({"text": text}))
        else:
            print("Extraction returned empty. Possible missing dependencies in binary.")
    else:
        print("Download failed. Check internet access or SSL in binary.")

if __name__ == "__main__":
    main()