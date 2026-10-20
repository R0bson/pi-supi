pub trait Surface {
    fn render(&self) -> String;
}

pub fn rename_me(value: i32) -> i32 {
    value + 1
}

mod impls;
mod broken;
