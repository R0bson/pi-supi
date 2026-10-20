use language_baseline::rename_me;

fn main() {
    let value = rename_me(2);
    let known_error: i32 = 1 + "wrong";
    println!("{} {}", value, known_error);
}
