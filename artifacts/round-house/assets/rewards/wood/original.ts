import part0 from "./part-00";
import part1 from "./part-01";
import part2 from "./part-02";
import part3 from "./part-03";
// Exact supplied artwork; split for reliable uploads.
export default { uri: "data:image/jpeg;base64," + [part0, part1, part2, part3].join("") };
