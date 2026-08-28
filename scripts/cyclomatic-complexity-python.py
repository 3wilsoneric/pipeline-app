#!/usr/bin/env python3

import ast
import json
import pathlib
import sys


class DecisionCounter(ast.NodeVisitor):
    def __init__(self):
        self.decisions = 0
        self.depth = 0
        self.max_depth = 0

    def branch(self, node):
        self.decisions += 1
        self.depth += 1
        self.max_depth = max(self.max_depth, self.depth)
        self.generic_visit(node)
        self.depth -= 1

    def visit_If(self, node):
        self.branch(node)

    def visit_For(self, node):
        self.branch(node)

    def visit_AsyncFor(self, node):
        self.branch(node)

    def visit_While(self, node):
        self.branch(node)

    def visit_ExceptHandler(self, node):
        self.branch(node)

    def visit_IfExp(self, node):
        self.branch(node)

    def visit_BoolOp(self, node):
        self.decisions += max(0, len(node.values) - 1)
        self.generic_visit(node)

    def visit_Match(self, node):
        self.decisions += len(node.cases)
        self.generic_visit(node)

    def visit_comprehension(self, node):
        self.decisions += 1 + len(node.ifs)
        self.generic_visit(node)

    def visit_FunctionDef(self, node):
        return None

    def visit_AsyncFunctionDef(self, node):
        return None

    def visit_Lambda(self, node):
        return None


class FunctionCollector(ast.NodeVisitor):
    def __init__(self, relative_path):
        self.relative_path = relative_path
        self.context = []
        self.functions = []

    def visit_ClassDef(self, node):
        self.context.append(node.name)
        self.generic_visit(node)
        self.context.pop()

    def collect_function(self, node, name):
        qualified_name = ".".join([*self.context, name])
        counter = DecisionCounter()
        for statement in node.body:
            counter.visit(statement)
        self.functions.append({
            "path": self.relative_path,
            "name": qualified_name,
            "line": node.lineno,
            "complexity": counter.decisions + 1,
            "branches": counter.decisions,
            "maxBranchDepth": counter.max_depth,
            "language": "python",
        })
        self.context.append(name)
        self.generic_visit(node)
        self.context.pop()

    def visit_FunctionDef(self, node):
        self.collect_function(node, node.name)

    def visit_AsyncFunctionDef(self, node):
        self.collect_function(node, node.name)

    def visit_Lambda(self, node):
        counter = DecisionCounter()
        counter.visit(node.body)
        name = "<lambda>"
        self.functions.append({
            "path": self.relative_path,
            "name": ".".join([*self.context, name]),
            "line": node.lineno,
            "complexity": counter.decisions + 1,
            "branches": counter.decisions,
            "maxBranchDepth": counter.max_depth,
            "language": "python",
        })


def analyze(relative_path):
    path = pathlib.Path(relative_path)
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=relative_path)
    collector = FunctionCollector(relative_path)
    collector.visit(tree)
    return collector.functions


def main():
    functions = []
    for relative_path in sys.argv[1:]:
        functions.extend(analyze(relative_path))
    print(json.dumps({"functions": functions}, separators=(",", ":")))


if __name__ == "__main__":
    main()
