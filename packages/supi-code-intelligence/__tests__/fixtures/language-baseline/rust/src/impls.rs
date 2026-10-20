use crate::Surface;

pub struct Widget;

impl Surface for Widget {
    fn render(&self) -> String {
        crate::rename_me(2).to_string()
    }
}
