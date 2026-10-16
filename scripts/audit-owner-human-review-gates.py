#!/usr/bin/env python3
"""Read-only whole-tree audit of HUMAN security-auditor requirements on owner repositories.
No executable source from repositories is run. Independent certification is NOT treated as product release.
Outputs immutable tree revisions and every relevant executable mention for review.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request

OWNER = "neophilism"
EXCLUDED = {"facerec", "hubs", "neurosynth", "pupil"}
SOURCE = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".sh",
          ".bash", ".ps1", ".rb", ".java", ".php", ".sql", ".yml", ".yaml", ".json",
          ".toml", ".tf", ".hcl", ".xml"}
TOPIC = re.compile(
    r"(independent\s+(?:human\s+|security\s+|expert\s+)?(?:audit|auditor|review|reviewer|sign.?off)|"
    r"external\s+(?:human\s+|security\s+|expert\s+)?(?:audit|auditor|review|reviewer|penetration\s+test)|"
    r"third[\s-]+party\s+(?:security|audit|review|reviewer)|"
    r"human\s+(?:security\s+)?(?:audit|review|approval|sign.?off)|"
    r"e2eesa.{0,35}certif|(?:audit|review|certif).{0,35}e2eesa|"
    r"independentreview|independent_review|externalreview|external_review|"
    r"securityreview|security_review|"
    r"reviewer.{0,30}independent)",
    re.I
)
BLOCK = re.compile(
    r"\b(?:if|unless|elif|while|throw|raise|assert|require|must|blocked|blocker|blocking|"
    r"cannot|can't|denied|fail|halt|stop|not.?ready|ineligible|gate|check|validate|"
    r"accept|approved|deploy|promot|publish|merge|release|ready|sign.?off|pass|reject)\b", re.I
)
NEGATIVE = re.compile(
    r"without waiting|do not (?:require|block|wait)|not (?:a |an )?(?:prerequisite|blocker|gate)|"
    r"deferred|not required|optional|pending.{0,40}not.{0,25}block", re.I
)
CERTIFICATION = re.compile(r"certification|conformance|certificationeligible|certification_eligible",re.I)

def api_repos():
    token = os.environ.get("GITHUB_TOKEN", "")
    output = []
    for page in range(1, 10):
        url = f"https://api.github.com/users/{OWNER}/repos?type=owner&per_page=100&page={page}"
        headers = {"Accept":"application/vnd.github+json", "User-Agent":"owner-release-review-audit"}
        if token:
            headers["Authorization"] = "Bearer " + token
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
            data = json.load(response)
        if not isinstance(data,list):
            raise RuntimeError("GitHub inventory returned an unexpected response")
        output += data
        if len(data)<100:
            break
    names = sorted(x["name"] for x in output if x.get("owner",{}).get("login") == OWNER and not x.get("archived"))
    if not EXCLUDED.issubset(set(names)) or len(names) < 47 or len(names) != len(set(names)):
        raise RuntimeError("Incomplete repository inventory; refusing clean assertion")
    if any(x.get("private") for x in output):
        raise RuntimeError("Some repositories were private; public read-only clone cannot prove full coverage")
    return [n for n in names if n not in EXCLUDED], len(names)

def run(*args, cwd=None, timeout=90):
    return subprocess.check_output(args, cwd=cwd, timeout=timeout, stderr=subprocess.PIPE)

def normal(text):
    return re.sub(r"([a-z])([A-Z])",r"\1 \2",text).replace("_"," ").replace("-", " ")

def code_path(path):
    p = Path(path)
    if path.startswith((".github/workflows/", ".circleci/")) or p.name in (
        "Dockerfile", "Jenkinsfile", "Makefile", "render.yaml", "render.yml", "Procfile"):
        return True
    return p.suffix.lower() in SOURCE

def kind(path):
    bits=path.lower().split("/")
    if path == "AGENTS.md":
        return "agent-policy"
    if any(x in bits for x in ("docs","test","tests","fixtures","examples","sample","samples","testdata")):
        return "nonexecuting-reference"
    if path.endswith((".schema.json",".lock",".lock.json")) or path.startswith(("registry/", "security/e2eesa-status", "security/e2eesa-inventory")):
        return "schema-or-status"
    if code_path(path):
        return "executable-or-config"
    return "documentation"

def redact(s):
    s = re.sub(r"((?:https?://|postgres(?:ql)?://)[^\s:@]+:)[^\s@]+(@)",r"\1[REDACTED]\2",s)
    return s[:320]

def inspect_repo(name, root):
    destination=root/name
    url=f"https://github.com/{OWNER}/{name}.git"
    run("git","-c","credential.helper=","clone","-q","--depth=1","--no-tags",url,str(destination),timeout=120)
    sha=run("git","rev-parse","HEAD",cwd=destination).decode().strip()
    paths=run("git","ls-files","-z",cwd=destination).decode("utf-8").split("\0")
    policy=destination/"AGENTS.md"
    good = (policy.is_file() and
            "Owner security-review policy" in policy.read_text(encoding="utf-8") and
            "without waiting for an independent human security review" in policy.read_text(encoding="utf-8"))
    summary={"repository":f"{OWNER}/{name}","sha":sha,"files":0,"textFiles":0,
             "policy":good,"findings":[],"oversize":[],"errors":[]}
    for path in paths:
        if not path: continue
        summary["files"] += 1
        file=destination/path
        if file.is_symlink() or not file.is_file() or file.stat().st_size>1500000:
            if code_path(path):
                summary["oversize"].append(path)
            continue
        if not (code_path(path) or file.suffix.lower() in (".md",".rst",".txt") or file.name == "AGENTS.md"):
            continue
        try: data=file.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            if code_path(path):summary["errors"].append(path+" unreadable UTF-8")
            continue
        summary["textFiles"] += 1
        lines=data.splitlines()
        k=kind(path)
        for i,line in enumerate(lines):
            if not TOPIC.search(normal(line)): continue
            around=" ".join(normal(z) for z in lines[max(0,i-3):min(len(lines),i+4)])
            mark="mention"
            if k=="executable-or-config" and BLOCK.search(around) and not NEGATIVE.search(around):
                mark="executable-candidate"
                if CERTIFICATION.search(around): mark="certification-or-release-candidate"
            elif k=="schema-or-status":mark="status-or-schema"
            elif k=="nonexecuting-reference":mark="test-or-fixture"
            summary["findings"].append({"path":path,"line":i+1,"kind":k,"class":mark,
                                        "excerpt":redact(line.strip())})
    summary["counts"]={level:sum(f["class"]==level for f in summary["findings"])
                       for level in ("executable-candidate","certification-or-release-candidate",
                                     "status-or-schema","test-or-fixture","mention")}
    return summary

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output",default="artifacts/human-audit-gates.json")
    args=p.parse_args()
    names,total=api_repos()
    reports=[]
    with tempfile.TemporaryDirectory(prefix="owner-review-audit-") as t:
        root=Path(t)
        for i,name in enumerate(names,1):
            try:
                result=inspect_repo(name,root)
                reports.append(result)
                print(f"{i:02}/{len(names)} {name}: policy={result['policy']} "
                      f"files={result['files']} executableCandidates="
                      f"{result['counts']['executable-candidate']} "
                      f"certificationOrReleaseCandidates={result['counts']['certification-or-release-candidate']} "
                      f"scanErrors={len(result['errors'])+len(result['oversize'])}",flush=True)
                for f in result["findings"]:
                    if f["class"] in ("executable-candidate","certification-or-release-candidate"):
                        print(f"  REVIEW {f['path']}:{f['line']} [{f['class']}] {f['excerpt']}",flush=True)
            except Exception as e:
                reports.append({"repository":f"{OWNER}/{name}","error":str(e),"policy":False})
                print(f"ERROR {name}: {type(e).__name__}: {str(e)}",flush=True)
    destination=Path(args.output)
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text(json.dumps({"owner":OWNER,"visibleRepositories":total,
        "excluded":sorted(EXCLUDED),"coveredRepositories":len(names),"results":reports},
        indent=2)+"\n",encoding="utf-8")
    problems=[r for r in reports if not r.get("policy") or r.get("error") or r.get("errors") or r.get("oversize")]
    print(f"SUMMARY repo_count={len(reports)} policy_missing={sum(not r.get('policy') for r in reports)} "
          f"scan_errors={len(problems)} output={destination}")
    if problems: raise SystemExit(2)

if __name__=="__main__":
    main()
