from model import Surface, rename_me


class Widget(Surface):
    def render(self) -> str:
        return str(rename_me(2))


known_error: int = 1 + "wrong"
