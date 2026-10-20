package model

type Surface interface {
	Render() string
}

func RenameMe(value int) int {
	return increment(value + 1)
}

func increment(value int) int {
	return value
}
