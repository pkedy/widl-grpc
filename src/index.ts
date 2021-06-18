import {
  Context,
  BaseVisitor,
  Kind,
  Named,
  Optional,
  Type,
  ListType,
  MapType,
  Name,
  TypeDefinition,
  FieldDefinition,
  OperationDefinition,
  StringValue,
} from "@wapc/widl/ast";
import { isVoid } from "@wapc/widl-codegen/assemblyscript";
import {
  shouldIncludeHandler,
  snakeCase,
  pascalCase,
  formatComment,
} from "@wapc/widl-codegen/utils";

interface FieldNumDirective {
  value: number;
}

export class GRPCVisitor extends BaseVisitor {
  private requestTypes = new Array<TypeDefinition>();

  visitDocumentBefore(context: Context): void {
    this.write(`syntax = "proto3";\n\n`);
  }

  visitDocumentAfter(context: Context): void {
    for (let request of this.requestTypes) {
      request.accept(context.clone({ type: request }), this);
    }
  }

  visitNamespace(context: Context): void {
    const ns = context.namespace;
    this.write(`package ${ns.name.value};\n\n`);
  }

  visitRoleBefore(context: Context): void {
    if (!shouldIncludeHandler(context)) {
      return;
    }
    const role = context.role!;
    this.write(formatComment("// ", role.description));
    this.write(`service ${role.name.value} {\n`);
  }

  visitRoleAfter(context: Context): void {
    if (!shouldIncludeHandler(context)) {
      return;
    }
    this.write(`}\n\n`);
  }

  visitOperationBefore(context: Context): void {
    if (!shouldIncludeHandler(context)) {
      return;
    }
    const oper = context.operation!;
    this.write(formatComment("  // ", oper.description));
    this.write(`  rpc ${pascalCase(oper.name.value)}(`);
    if (oper.unary) {
      this.write(`${typeSignature(oper.parameters[0].type)}`);
    } else {
      this.requestTypes.push(this.convertOperationToType(oper));
      this.write(`${pascalCase(oper.name.value)}Request`);
    }
    this.write(`) returns (`);
    if (isVoid(oper.type)) {
      this.write(`Empty`);
    } else {
      this.write(`${typeSignature(oper.type)}`);
    }
    this.write(`);\n`);
  }

  visitOperationAfter(context: Context): void {
    if (!shouldIncludeHandler(context)) {
      return;
    }
    const oper = context.operation!;
  }

  visitTypeBefore(context: Context): void {
    const type = context.type!;
    this.write(formatComment("// ", type.description));
    this.write(`message ${pascalCase(type.name.value)} {\n`);
  }

  visitTypeField(context: Context): void {
    const type = context.type!;
    const field = context.field!;
    const fieldnumAnnotation = field.annotation("fieldnum");
    if (!fieldnumAnnotation) {
      throw new Error(
        `${type.name.value}.${field.name.value} requires a @fieldnum`
      );
    }
    const fieldnum = fieldnumAnnotation.convert<FieldNumDirective>();
    this.write(formatComment("  // ", field.description));
    this.write(
      `  ${typeSignature(field.type)} ${snakeCase(field.name.value)} = ${
        fieldnum.value
      };\n`
    );
  }

  visitTypeAfter(context: Context): void {
    this.write(`}\n\n`);
  }

  visitEnumBefore(context: Context): void {
    const e = context.enum!;
    this.write(formatComment("// ", e.description));
    this.write(`enum ${pascalCase(e.name.value)} {\n`);
  }

  visitEnumValue(context: Context): void {
    const ev = context.enumValue!;
    this.write(formatComment("  // ", ev.description));
    this.write(
      `  ${snakeCase(ev.name.value).toUpperCase()} = ${ev.index.value};\n`
    );
  }

  visitEnumAfter(context: Context): void {
    this.write(`}\n\n`);
  }

  visitUnion(context: Context): void {
    const u = context.union!;
    this.write(formatComment("// ", u.description));
    this.write(`message ${pascalCase(u.name.value)} {\n`);
    this.write(`  oneof oneof {\n`);
    let i = 0;
    for (let t of u.types) {
      i++;
      this.write(
        `    ${typeSignature(t)} ${snakeCase(t.name.value)}_value = ${i};\n`
      );
    }
    this.write(`  }\n`);
    this.write(`}\n\n`);
  }

  private convertOperationToType(
    operation: OperationDefinition
  ): TypeDefinition {
    var fields = operation.parameters.map((param) => {
      return new FieldDefinition(
        param.loc,
        param.name,
        param.description,
        param.type,
        param.default,
        param.annotations
      );
    });
    return new TypeDefinition(
      operation.loc,
      new Name(
        operation.name.loc,
        pascalCase(operation.name.value) + "Request"
      ),
      new StringValue(
        undefined,
        `Request for the ${pascalCase(operation.name.value)} operation.`
      ),
      [],
      operation.annotations,
      fields
    );
  }
}

const scalarTypeMap = new Map<string, string>([
  ["i8", "int32"],
  ["i16", "int32"],
  ["i32", "int32"],
  ["i64", "int64"],
  ["u8", "uint32"],
  ["u16", "uint32"],
  ["u32", "uint32"],
  ["u64", "uint64"],
  ["f32", "float"],
  ["f64", "double"],
  ["string", "string"],
  ["bytes", "bytes"],
  ["boolean", "bool"],
  ["date", "google.protobuf.Timestamp"],
  ["datetime", "google.protobuf.Timestamp"],
  ["raw", "google.protobuf.Any"],
]);

function typeSignature(type: Type): string {
  switch (type.getKind()) {
    case Kind.Named:
      const named = type as Named;
      return scalarTypeMap.get(named.name.value) || named.name.value;
    case Kind.ListType:
      return `repeated ${typeSignature((type as ListType).type)}`;
    case Kind.MapType:
      const map = type as MapType;
      // TODO: Map keys cannot be float/double, bytes or message types
      // TODO: Map values cannot be repeated
      return `map<${typeSignature(map.keyType)}, ${typeSignature(
        map.valueType
      )}>`;
    case Kind.Optional:
      return `optional ${typeSignature((type as Optional).type)}`;
    default:
      throw new Error("unexpected kind: " + type.getKind());
  }
}
