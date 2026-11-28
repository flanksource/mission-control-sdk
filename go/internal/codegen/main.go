// Command codegen writes the declarations Extract selects to a Go file.

package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
)

func main() {
	var opts Options
	var files, types, consts, out string
	flag.StringVar(&opts.Dir, "dir", "", "directory of the package to copy from")
	flag.StringVar(&files, "files", "", "comma-separated source files in -dir")
	flag.StringVar(&types, "types", "", "comma-separated type names to copy")
	flag.StringVar(&consts, "consts", "", "comma-separated const names whose blocks to copy")
	flag.StringVar(&opts.Package, "package", "", "package clause of the output")
	flag.StringVar(&opts.Source, "source", "", "module@version recorded in the generated header")
	flag.StringVar(&out, "out", "", "file to write")
	flag.Parse()
	opts.Files, opts.Types, opts.Consts = split(files), split(types), split(consts)

	if out == "" {
		fail(fmt.Errorf("-out is required"))
	}
	generated, err := Extract(opts)
	if err != nil {
		fail(err)
	}
	if err := os.WriteFile(out, generated, 0o644); err != nil {
		fail(err)
	}
}

func split(value string) []string {
	if value == "" {
		return nil
	}
	return strings.Split(value, ",")
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "codegen:", err)
	os.Exit(1)
}
