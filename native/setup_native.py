"""Build the C++ pybind11 extension.

    python native/setup_native.py build_ext --inplace

Compiles ``zeromiss_native`` into ``native/`` so the cross-check test can import it.
Requires a C++ compiler (MSVC Build Tools on Windows; gcc/clang elsewhere) and pybind11
(``pip install pybind11``). On GitHub's ubuntu runners both are present.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pybind11
from setuptools import Extension, setup

HERE = Path(__file__).parent

ext = Extension(
    "zeromiss_native",
    sources=[str(HERE / "zeromiss_native.cpp")],
    include_dirs=[pybind11.get_include()],
    language="c++",
    extra_compile_args=["/O2", "/std:c++17"] if sys.platform == "win32" else ["-O3", "-std=c++17"],
)

setup(
    name="zeromiss_native",
    version="0.1.0",
    ext_modules=[ext],
    script_args=["build_ext", "--inplace"] if len(sys.argv) == 1 else sys.argv[1:],
)
