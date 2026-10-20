package model

import "fmt"

type Widget struct{}

func (Widget) Render() string {
	return fmt.Sprint(RenameMe(2))
}
