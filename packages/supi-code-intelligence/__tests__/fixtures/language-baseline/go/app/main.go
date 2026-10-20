package main

import "example.com/language-baseline/model"

func main() {
	value := model.RenameMe(2)
	knownError := 1 + "wrong"
	_ = value + knownError
}
