-- 合成演示：PostgreSQL 15+ 语法；仅静态示例，未执行数据库。
CREATE TABLE demo_category (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE
);
COMMENT ON TABLE demo_category IS '合成设备分类，仅用于技能演示';
COMMENT ON COLUMN demo_category.id IS '分类标识，数据库生成';
COMMENT ON COLUMN demo_category.name IS '分类名称，全局唯一，最多64字符';
CREATE TABLE demo_device (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id BIGINT NOT NULL REFERENCES demo_category(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    name VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled'))
);
COMMENT ON TABLE demo_device IS '合成设备，仅用于技能演示';
COMMENT ON COLUMN demo_device.id IS '设备标识，数据库生成';
COMMENT ON COLUMN demo_device.category_id IS '所属分类，禁止删除被引用分类';
COMMENT ON COLUMN demo_device.name IS '设备名称，最多128字符，不要求唯一';
COMMENT ON COLUMN demo_device.status IS '状态：active可用，disabled停用';
-- 分类设备列表按主键稳定排序；主键和分类唯一名称已由约束建立索引。
CREATE INDEX idx_demo_device_category_id ON demo_device(category_id, id);
