package com.qs.authority.security;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.config.AuthorityProperties;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * 口令散列、复杂度校验与随机初始口令生成。
 *
 * <p>口令只保存 BCrypt 散列；明文仅出现在新口令提交或随机重置的成功响应中一次。
 * 复杂度规则：字符数不小于配置值（默认 8），同时包含数字、字母、特殊字符，且 UTF-8 编码后不超过
 * BCrypt 的 72 字节上限。上限按字节而不是字符判断，否则多字节口令会以 40001 之外的 500 失败。
 */
@Component
public class PasswordService {

    /** BCrypt 的输入上限：超过该字节数时散列实现会直接抛异常。 */
    private static final int MAX_PASSWORD_BYTES = 72;

    private static final String DIGITS = "0123456789";
    private static final String LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private static final String SPECIALS = "!@#$%^&*()-_=+";

    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    private final SecureRandom random = new SecureRandom();
    private final AuthorityProperties properties;

    /**
     * 构造口令服务。
     *
     * @param properties 部署配置
     */
    public PasswordService(AuthorityProperties properties) {
        this.properties = properties;
    }

    /**
     * 生成口令散列。
     *
     * @param raw 明文口令
     * @return BCrypt 散列
     */
    public String encode(String raw) {
        return encoder.encode(raw);
    }

    /**
     * 校验明文口令与散列是否匹配。
     *
     * @param raw 明文口令
     * @param hash 口令散列；为空时不匹配
     * @return 匹配为 true
     */
    public boolean matches(String raw, String hash) {
        if (raw == null || hash == null) {
            return false;
        }
        try {
            return encoder.matches(raw, hash);
        } catch (IllegalArgumentException exception) {
            // 超出散列实现可处理长度的输入不可能匹配任何已存口令；按不匹配处理，不返回 500。
            return false;
        }
    }

    /**
     * 校验口令复杂度。
     *
     * @param raw 明文口令
     * @param field 字段名，用于 40001 定位
     * @throws BusinessException 不满足复杂度要求时抛出 40001
     */
    public void requireComplex(String raw, String field) {
        int minLength = properties.password().minLength();
        if (raw == null || raw.length() < minLength) {
            throw BusinessException.invalidField(field, "密码长度不能少于 " + minLength + " 位");
        }
        boolean hasDigit = raw.chars().anyMatch(Character::isDigit);
        boolean hasLetter = raw.chars().anyMatch(Character::isLetter);
        boolean hasSpecial = raw.chars().anyMatch(character -> SPECIALS.indexOf(character) >= 0
                || (!Character.isLetterOrDigit(character) && !Character.isWhitespace(character)));
        if (!hasDigit || !hasLetter || !hasSpecial) {
            throw BusinessException.invalidField(field, "密码必须同时包含数字、字母和特殊字符");
        }
        int bytes = raw.getBytes(StandardCharsets.UTF_8).length;
        if (bytes > MAX_PASSWORD_BYTES) {
            throw BusinessException.invalidField(field,
                    "密码过长：UTF-8 编码后不能超过 " + MAX_PASSWORD_BYTES + " 字节（当前 " + bytes + " 字节）");
        }
    }

    /**
     * 生成满足复杂度的随机初始口令。
     *
     * @return 随机口令明文，只返回一次
     */
    public String generateRandom() {
        int length = Math.max(properties.password().minLength(), 12);
        List<Character> characters = new ArrayList<>(length);
        characters.add(randomOf(DIGITS));
        characters.add(randomOf(LETTERS));
        characters.add(randomOf(SPECIALS));
        String pool = DIGITS + LETTERS + SPECIALS;
        while (characters.size() < length) {
            characters.add(randomOf(pool));
        }
        Collections.shuffle(characters, random);
        StringBuilder builder = new StringBuilder(length);
        characters.forEach(builder::append);
        return builder.toString();
    }

    private char randomOf(String pool) {
        return pool.charAt(random.nextInt(pool.length()));
    }
}
